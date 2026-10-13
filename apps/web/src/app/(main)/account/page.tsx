import { ActionForm } from '@/components/action-form';
import { Badge, Card, Field } from '@/components/ui';
import { mfaRequired, requireUser } from '@/lib/auth';
import { changePasswordAction, setMfaOptOutAction } from '../(auth)/actions';

export const metadata = { title: 'Account' };

export default async function AccountPage() {
  const user = await requireUser();
  const canOptOut = process.env.ALLOW_2FA_OPT_OUT === 'true' && !user.isAdmin;
  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-4 py-10 md:grid-cols-2">
      <Card title="Change password">
        <ActionForm action={changePasswordAction} submitLabel="Update password">
          <Field label="Current password"><input className="input" type="password" name="current" autoComplete="current-password" required /></Field>
          <Field label="New password" hint="At least 10 characters."><input className="input" type="password" name="password" autoComplete="new-password" minLength={10} required /></Field>
          <Field label="Confirm new password"><input className="input" type="password" name="confirm" autoComplete="new-password" minLength={10} required /></Field>
        </ActionForm>
      </Card>
      <Card title="Security">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between"><dt className="text-slate-400">Email (username)</dt><dd className="text-white">{user.email}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-400">Two-factor authentication</dt><dd>{user.totpEnabled ? <Badge color="green">On</Badge> : <Badge color="amber">Off</Badge>}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-400">Role</dt><dd className="text-white">{user.isAdmin ? 'Site administrator' : 'Member'}</dd></div>
        </dl>
        <p className="mt-4 text-xs text-slate-500">
          {mfaRequired(user) ? 'Two-factor authentication is required for every account on this server.' : 'This server lets standard users turn off two-factor authentication.'}
          {' '}To move 2FA to a new phone, ask an administrator to reset it; you&apos;ll set it up again at your next sign-in.
        </p>
        {canOptOut && (
          <div className="mt-4">
            <ActionForm action={setMfaOptOutAction} submitLabel="Save" submitClassName="btn-secondary btn-sm">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" name="disable" defaultChecked={user.mfaOptOut} className="accent-emerald-500" /> Turn off two-factor authentication (not recommended)
              </label>
            </ActionForm>
          </div>
        )}
      </Card>
    </main>
  );
}
