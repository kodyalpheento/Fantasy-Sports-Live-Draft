import { count, desc, eq } from 'drizzle-orm';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Badge, Card, formatDate } from '@/components/ui';
import { getDb } from '@/db';
import { players, users } from '@/db/schema';
import { requireAdmin } from '@/lib/auth';
import { lastPlayerSync } from '@/lib/players';
import { resetUserMfaAction, syncPlayersAction, toggleAdminAction } from './actions';

export default async function AdminPage() {
  const me = await requireAdmin();
  const db = getDb();
  const [userRows, [{ n: playerCount }], [{ n: activeCount }], sync] = await Promise.all([
    db.select().from(users).orderBy(desc(users.createdAt)).limit(500),
    db.select({ n: count() }).from(players),
    db.select({ n: count() }).from(players).where(eq(players.active, true)),
    lastPlayerSync(),
  ]);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <Card title={`Users (${userRows.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="py-2">Name</th><th>Email</th><th>2FA</th><th>Joined</th><th /></tr>
            </thead>
            <tbody>
              {userRows.map((u) => (
                <tr key={u.id} className="table-row">
                  <td className="py-2 font-medium text-white">{u.displayName} {u.isAdmin && <Badge color="violet">Admin</Badge>}</td>
                  <td className="text-slate-300">{u.email}</td>
                  <td>{u.totpEnabled ? <Badge color="green">On</Badge> : <Badge color="amber">Off</Badge>}</td>
                  <td className="text-slate-400">{formatDate(u.createdAt, { dateStyle: 'medium' })}</td>
                  <td className="text-right">
                    {u.id !== me.id && (
                      <div className="flex justify-end gap-1">
                        {u.totpEnabled && (
                          <form action={resetUserMfaAction.bind(null, u.id)}>
                            <SubmitButton className="btn-ghost btn-sm" confirm={`Reset 2FA for ${u.email}? They will set it up again at next sign-in.`}>Reset 2FA</SubmitButton>
                          </form>
                        )}
                        <form action={toggleAdminAction.bind(null, u.id)}>
                          <SubmitButton className="btn-ghost btn-sm">{u.isAdmin ? 'Remove admin' : 'Make admin'}</SubmitButton>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="NFL player data">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-slate-400">Players stored</dt><dd className="text-white">{playerCount} ({activeCount} active)</dd></div>
          <div className="flex justify-between"><dt className="text-slate-400">Last sync</dt><dd className="text-white">{sync ? formatDate(sync.at) : 'Never'}</dd></div>
          {sync && !sync.ok && <p className="text-red-300">{sync.error}</p>}
        </dl>
        <p className="my-3 text-xs text-slate-500">Positions, teams, headshots and rankings update automatically once a day from Sleeper.</p>
        <ActionForm action={syncPlayersAction} submitLabel="Sync now" submitClassName="btn-secondary" />
      </Card>
    </div>
  );
}
