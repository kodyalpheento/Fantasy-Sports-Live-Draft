'use server';

import { and, count, eq, gt, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionResult } from '@/components/action-form';
import { getDb } from '@/db';
import { passwordResets, sessions, users } from '@/db/schema';
import {
  checkTotp, createSession, destroySession, getSession, isAdminEmail, mfaRequired, pendingAuthStep, safeNext,
} from '@/lib/auth';
import { hashPassword, randomToken, sha256Hex, verifyPassword } from '@/lib/crypto';
import { passwordResetEmail, sendEmail } from '@/lib/email';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60_000;

const passwordSchema = z.string().min(10, 'Use at least 10 characters.').max(200);
const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address.').max(254);

function first(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input.';
}

export async function signupAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const parsed = z.object({
    email: emailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1, 'Enter your name.').max(60),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: first(parsed.error) };
  const { email, password, displayName } = parsed.data;
  if (fd.get('confirm') !== password) return { error: 'Passwords do not match.' };

  const db = getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (existing) return { error: 'An account with this email already exists. Sign in instead.' };
  const [{ n }] = await db.select({ n: count() }).from(users);
  const [user] = await db.insert(users).values({
    email,
    displayName,
    passwordHash: await hashPassword(password),
    isAdmin: n === 0 || isAdminEmail(email),
  }).returning();
  await createSession(user.id, false);
  revalidatePath('/', 'layout');
  redirect(`/setup-2fa?next=${encodeURIComponent(safeNext(fd.get('next')))}`);
}

export async function loginAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const password = String(fd.get('password') ?? '');
  const next = safeNext(fd.get('next'));
  const db = getDb();
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  const generic = { error: 'Email or password is incorrect.' };
  if (!user) {
    await hashPassword(password); // keep timing similar for unknown accounts
    return generic;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { error: 'Too many failed attempts. Try again in a few minutes, or reset your password.' };
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLogins + 1;
    await db.update(users).set({
      failedLogins: failed >= MAX_FAILED_LOGINS ? 0 : failed,
      lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : null,
    }).where(eq(users.id, user.id));
    return generic;
  }
  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
  await createSession(user.id, false);
  if (user.totpEnabled) redirect(`/verify-2fa?next=${encodeURIComponent(next)}`);
  if (mfaRequired(user)) redirect(`/setup-2fa?next=${encodeURIComponent(next)}`);
  revalidatePath('/', 'layout');
  redirect(next);
}

export async function verifyTotpAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await getSession();
  if (!s) redirect('/login');
  if (!(await checkTotp(s.user, String(fd.get('code') ?? '')))) return { error: 'That code is not valid. Check your authenticator app and try again.' };
  await getDb().update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, s.sessionId));
  revalidatePath('/', 'layout');
  redirect(safeNext(fd.get('next')));
}

export async function confirmTotpSetupAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await getSession();
  if (!s) redirect('/login');
  if (s.user.totpEnabled && !s.mfaVerified) redirect('/verify-2fa');
  if (!(await checkTotp(s.user, String(fd.get('code') ?? '')))) return { error: 'That code is not valid. Make sure your phone\'s clock is correct and try again.' };
  const db = getDb();
  await db.update(users).set({ totpEnabled: true }).where(eq(users.id, s.user.id));
  await db.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, s.sessionId));
  revalidatePath('/', 'layout');
  redirect(safeNext(fd.get('next')));
}

/** Only possible when the deployment allows standard users to opt out of 2FA. */
export async function skipTotpSetupAction(fd: FormData): Promise<void> {
  const s = await getSession();
  if (!s) redirect('/login');
  if (process.env.ALLOW_2FA_OPT_OUT === 'true' && !s.user.isAdmin) {
    await getDb().update(users).set({ mfaOptOut: true }).where(eq(users.id, s.user.id));
  }
  revalidatePath('/', 'layout');
  redirect(safeNext(fd.get('next')));
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  revalidatePath('/', 'layout');
  redirect('/login');
}

export async function forgotPasswordAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(fd.get('email'));
  if (!parsed.success) return { error: first(parsed.error) };
  const db = getDb();
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${parsed.data}`).limit(1);
  if (user) {
    const token = randomToken();
    await db.insert(passwordResets).values({ tokenHash: await sha256Hex(token), userId: user.id, expiresAt: new Date(Date.now() + 3600_000) });
    const url = `${process.env.APP_URL ?? 'http://localhost:3000'}/reset-password?token=${token}`;
    await sendEmail(passwordResetEmail(user.email, url));
  }
  return { ok: 'If an account exists for that email, a reset link is on its way. It expires in 1 hour.' };
}

export async function resetPasswordAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const token = String(fd.get('token') ?? '');
  const parsed = passwordSchema.safeParse(fd.get('password'));
  if (!parsed.success) return { error: first(parsed.error) };
  if (fd.get('confirm') !== parsed.data) return { error: 'Passwords do not match.' };
  const db = getDb();
  const hash = await sha256Hex(token);
  const [reset] = await db.select().from(passwordResets)
    .where(and(eq(passwordResets.tokenHash, hash), isNull(passwordResets.usedAt), gt(passwordResets.expiresAt, new Date()))).limit(1);
  if (!reset) return { error: 'This reset link is invalid or has expired. Request a new one.' };
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data), failedLogins: 0, lockedUntil: null }).where(eq(users.id, reset.userId));
  await db.update(passwordResets).set({ usedAt: new Date() }).where(eq(passwordResets.tokenHash, hash));
  await db.delete(sessions).where(eq(sessions.userId, reset.userId));
  revalidatePath('/', 'layout');
  redirect('/login?reset=1');
}

export async function changePasswordAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await getSession();
  if (!s || pendingAuthStep(s)) redirect('/login');
  if (!(await verifyPassword(String(fd.get('current') ?? ''), s.user.passwordHash))) return { error: 'Your current password is incorrect.' };
  const parsed = passwordSchema.safeParse(fd.get('password'));
  if (!parsed.success) return { error: first(parsed.error) };
  if (fd.get('confirm') !== parsed.data) return { error: 'Passwords do not match.' };
  const db = getDb();
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data) }).where(eq(users.id, s.user.id));
  // Sign out every other device.
  await db.delete(sessions).where(and(eq(sessions.userId, s.user.id), sql`${sessions.id} <> ${s.sessionId}`));
  return { ok: 'Password updated. Other devices have been signed out.' };
}

export async function setMfaOptOutAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await getSession();
  if (!s || pendingAuthStep(s)) redirect('/login');
  if (process.env.ALLOW_2FA_OPT_OUT !== 'true' || s.user.isAdmin) return { error: 'Two-factor authentication is required on this server.' };
  const disable = fd.get('disable') === 'on';
  await getDb().update(users).set(disable
    ? { mfaOptOut: true, totpEnabled: false, totpSecretEnc: null, totpLastStep: null }
    : { mfaOptOut: false }).where(eq(users.id, s.user.id));
  return { ok: disable ? '2FA turned off.' : 'Saved.' };
}
