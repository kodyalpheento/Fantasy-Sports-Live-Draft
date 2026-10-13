import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/ui';
import { getSession, pendingAuthStep, safeNext } from '@/lib/auth';
import { loginAction } from '../actions';
import { AuthShell } from '../shell';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string; restored?: string; email?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const s = await getSession();
  if (s) redirect(pendingAuthStep(s) ?? next);
  return (
    <AuthShell
      title="Welcome back"
      subtitle={sp.restored ? 'Backup restored. Everyone needs to sign in again.' : sp.reset ? 'Password updated — sign in with your new password.' : 'Sign in with your email and password.'}
      footer={<>New here? <Link className="text-brand-400 hover:underline" href={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link></>}
    >
      <ActionForm action={loginAction} submitLabel="Sign in" submitClassName="btn-primary w-full">
        <input type="hidden" name="next" value={next} />
        <Field label="Email"><input className="input" name="email" type="email" autoComplete="username" defaultValue={sp.email} required /></Field>
        <Field label="Password"><input className="input" name="password" type="password" autoComplete="current-password" required /></Field>
        <div className="text-right text-sm"><Link href="/forgot-password" className="text-slate-400 hover:text-white">Forgot password?</Link></div>
      </ActionForm>
    </AuthShell>
  );
}
