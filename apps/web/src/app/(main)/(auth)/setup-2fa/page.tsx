import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Field } from '@/components/ui';
import { getDb } from '@/db';
import { users } from '@/db/schema';
import { getSession, mfaRequired, safeNext, totpFor } from '@/lib/auth';
import { decryptSecret, encryptSecret } from '@/lib/crypto';
import { confirmTotpSetupAction, skipTotpSetupAction } from '../actions';
import { AuthShell } from '../shell';

export const metadata = { title: 'Set up two-factor authentication' };

export default async function SetupTotpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const s = await getSession();
  if (!s) redirect('/login');
  if (s.user.totpEnabled) redirect(s.mfaVerified ? next : `/verify-2fa?next=${encodeURIComponent(next)}`);

  // Keep the same pending secret across reloads until it is confirmed.
  let secret: string;
  if (s.user.totpSecretEnc) {
    secret = await decryptSecret(s.user.totpSecretEnc);
  } else {
    secret = new OTPAuth.Secret({ size: 20 }).base32;
    await getDb().update(users).set({ totpSecretEnc: await encryptSecret(secret) }).where(eq(users.id, s.user.id));
  }
  const uri = totpFor(s.user.email, secret).toString();
  const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, color: { dark: '#0c1222', light: '#ffffff' } });
  const canSkip = !mfaRequired({ isAdmin: s.user.isAdmin, mfaOptOut: true });

  return (
    <AuthShell title="Protect your account" subtitle="Scan this QR code with an authenticator app (Google Authenticator, 1Password, Authy, Microsoft Authenticator…), then enter the 6-digit code.">
      <div className="mx-auto mb-4 w-52 overflow-hidden rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: svg }} />
      <details className="mb-5 text-center text-xs text-slate-400">
        <summary className="cursor-pointer">Can&apos;t scan? Enter this key manually</summary>
        <code className="mt-2 block break-all rounded bg-ink-950 p-2 font-mono text-sm text-slate-200">{secret.match(/.{1,4}/g)?.join(' ')}</code>
      </details>
      <ActionForm action={confirmTotpSetupAction} submitLabel="Turn on 2FA" submitClassName="btn-primary w-full">
        <input type="hidden" name="next" value={next} />
        <Field label="6-digit code">
          <input className="input text-center text-2xl tracking-[0.5em]" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required />
        </Field>
      </ActionForm>
      {canSkip && (
        <form action={skipTotpSetupAction} className="mt-3 text-center">
          <input type="hidden" name="next" value={next} />
          <SubmitButton className="btn-ghost btn-sm">Skip for now (not recommended)</SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
