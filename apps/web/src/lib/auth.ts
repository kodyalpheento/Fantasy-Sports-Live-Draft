import 'server-only';
import { and, eq, gt } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import * as OTPAuth from 'otpauth';
import { cache } from 'react';
import { getDb } from '@/db';
import { sessions, users, type User } from '@/db/schema';
import { decryptSecret, randomToken, sha256Hex } from './crypto';

export const SESSION_COOKIE = 'fsd_session';
const SESSION_DAYS = 30;
export const APP_NAME = 'Live Draft';

export interface CurrentSession {
  sessionId: string;
  mfaVerified: boolean;
  user: User;
}

export function isSecureCookie(): boolean {
  return (process.env.APP_URL ?? '').startsWith('https://');
}

export async function createSession(userId: string, mfaVerified: boolean): Promise<void> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await getDb().insert(sessions).values({ id: await sha256Hex(token), userId, mfaVerified, expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await getDb().delete(sessions).where(eq(sessions.id, await sha256Hex(token)));
  jar.delete(SESSION_COOKIE);
}

export const getSession = cache(async (): Promise<CurrentSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const id = await sha256Hex(token);
  const rows = await getDb()
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!rows[0]) return null;
  return { sessionId: id, mfaVerified: rows[0].session.mfaVerified, user: rows[0].user };
});

/** Admins always need 2FA. Everyone else does too unless the deployment explicitly allows opting out. */
export function mfaRequired(user: Pick<User, 'isAdmin' | 'mfaOptOut'>): boolean {
  if (user.isAdmin) return true;
  return !(process.env.ALLOW_2FA_OPT_OUT === 'true' && user.mfaOptOut);
}

/** Where a signed-in user still has to go before they can use the app, if anywhere. */
export function pendingAuthStep(s: CurrentSession): '/setup-2fa' | '/verify-2fa' | null {
  if (s.user.totpEnabled) return s.mfaVerified ? null : '/verify-2fa';
  return mfaRequired(s.user) ? '/setup-2fa' : null;
}

export async function requireUser(): Promise<User> {
  const s = await getSession();
  if (!s) redirect('/login');
  const step = pendingAuthStep(s);
  if (step) redirect(step);
  return s.user;
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (!user.isAdmin) redirect('/');
  return user;
}

/** For API routes: the fully authenticated user or null. */
export async function apiUser(): Promise<User | null> {
  const s = await getSession();
  if (!s || pendingAuthStep(s)) return null;
  return s.user;
}

export function totpFor(email: string, secretBase32: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: APP_NAME,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

/** Validate a TOTP code, rejecting replays of an already-used time step. */
export async function checkTotp(user: User, code: string): Promise<boolean> {
  if (!user.totpSecretEnc) return false;
  const clean = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const totp = totpFor(user.email, await decryptSecret(user.totpSecretEnc));
  const delta = totp.validate({ token: clean, window: 1 });
  if (delta === null) return false;
  const step = Math.floor(Date.now() / 30_000) + delta;
  if (user.totpLastStep != null && step <= user.totpLastStep) return false;
  await getDb().update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
  return true;
}

export function isAdminEmail(email: string): boolean {
  return (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}

export function safeNext(next: unknown): string {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
