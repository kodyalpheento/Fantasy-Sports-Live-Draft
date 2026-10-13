import { ActionForm } from '@/components/action-form';
import { Field } from '@/components/ui';
import { resetPasswordAction } from '../actions';
import { AuthShell } from '../shell';

export const metadata = { title: 'Choose a new password' };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = '' } = await searchParams;
  return (
    <AuthShell title="Choose a new password">
      <ActionForm action={resetPasswordAction} submitLabel="Update password" submitClassName="btn-primary w-full">
        <input type="hidden" name="token" value={token} />
        <Field label="New password" hint="At least 10 characters."><input className="input" name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <Field label="Confirm password"><input className="input" name="confirm" type="password" autoComplete="new-password" minLength={10} required /></Field>
      </ActionForm>
    </AuthShell>
  );
}
