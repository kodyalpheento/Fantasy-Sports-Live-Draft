import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/ui';
import { getSession, safeNext } from '@/lib/auth';
import { verifyTotpAction } from '../actions';
import { AuthShell } from '../shell';

export const metadata = { title: 'Two-factor authentication' };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const s = await getSession();
  if (!s) redirect('/login');
  if (!s.user.totpEnabled) redirect(`/setup-2fa?next=${encodeURIComponent(next)}`);
  if (s.mfaVerified) redirect(next);
  return (
    <AuthShell title="Enter your code" subtitle="Open your authenticator app and enter the 6-digit code for Live Draft.">
      <ActionForm action={verifyTotpAction} submitLabel="Verify" submitClassName="btn-primary w-full">
        <input type="hidden" name="next" value={next} />
        <Field label="Authentication code">
          <input className="input text-center text-2xl tracking-[0.5em]" name="code" inputMode="numeric" pattern="[0-9 ]{6,7}" autoComplete="one-time-code" maxLength={7} autoFocus required />
        </Field>
      </ActionForm>
      <p className="mt-4 text-xs text-slate-500">Lost your device? Ask a site administrator to reset two-factor authentication for your account.</p>
    </AuthShell>
  );
}
