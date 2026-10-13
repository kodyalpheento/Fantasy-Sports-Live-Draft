import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/ui';
import { getSession, safeNext } from '@/lib/auth';
import { signupAction } from '../actions';
import { AuthShell } from '../shell';

export const metadata = { title: 'Create account' };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getSession()) redirect(next);
  return (
    <AuthShell
      title="Create your account"
      subtitle="Your email is your username. You'll set up two-factor authentication next."
      footer={<>Already have an account? <Link className="text-brand-400 hover:underline" href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></>}
    >
      <ActionForm action={signupAction} submitLabel="Create account" submitClassName="btn-primary w-full">
        <input type="hidden" name="next" value={next} />
        <Field label="Your name"><input className="input" name="displayName" autoComplete="name" maxLength={60} required /></Field>
        <Field label="Email"><input className="input" name="email" type="email" autoComplete="username" defaultValue={sp.email} required /></Field>
        <Field label="Password" hint="At least 10 characters."><input className="input" name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <Field label="Confirm password"><input className="input" name="confirm" type="password" autoComplete="new-password" minLength={10} required /></Field>
      </ActionForm>
    </AuthShell>
  );
}
