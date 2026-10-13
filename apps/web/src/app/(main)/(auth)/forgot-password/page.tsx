import Link from 'next/link';
import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/ui';
import { forgotPasswordAction } from '../actions';
import { AuthShell } from '../shell';

export const metadata = { title: 'Reset password' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link to choose a new password." footer={<Link href="/login" className="hover:text-white">Back to sign in</Link>}>
      <ActionForm action={forgotPasswordAction} submitLabel="Send reset link" submitClassName="btn-primary w-full">
        <Field label="Email"><input className="input" name="email" type="email" autoComplete="username" required /></Field>
      </ActionForm>
    </AuthShell>
  );
}
