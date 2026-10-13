import { and, desc, eq, isNull } from 'drizzle-orm';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { AutoSubmitSelect } from '@/components/client-inputs';
import { Badge, Card, Empty, Field } from '@/components/ui';
import { getDb } from '@/db';
import { invites, leagueMembers, users } from '@/db/schema';
import { leagueTeams, requireLeague } from '@/lib/leagues';
import {
  assignOwnerAction, clearTeamAudioAction, inviteMemberAction, moveTeamAction, randomizeOrderAction, removeMemberAction,
  renameTeamAction, revokeInviteAction, setMemberRoleAction, uploadTeamAudioAction,
} from '../../actions';

export default async function MembersPage({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  const { user, isCommissioner, config } = await requireLeague(leagueId);
  const db = getDb();
  const [teamRows, members, pending] = await Promise.all([
    leagueTeams(leagueId),
    db.select({ id: users.id, name: users.displayName, email: users.email, role: leagueMembers.role })
      .from(leagueMembers).innerJoin(users, eq(users.id, leagueMembers.userId)).where(eq(leagueMembers.leagueId, leagueId)).orderBy(users.displayName),
    isCommissioner
      ? db.select().from(invites).where(and(eq(invites.leagueId, leagueId), isNull(invites.acceptedAt))).orderBy(desc(invites.createdAt))
      : Promise.resolve([]),
  ]);
  const ownerName = (id: string | null) => members.find((m) => m.id === id)?.name;
  const audioMode = config.draft.audio.announceMode === 'audio';

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="xl:col-span-2" title="Teams & draft order" actions={isCommissioner && (
        <form action={randomizeOrderAction.bind(null, leagueId)}>
          <SubmitButton className="btn-secondary btn-sm" confirm="Shuffle the draft order randomly?">🎲 Randomize order</SubmitButton>
        </form>
      )}>
        <ul className="space-y-2">
          {teamRows.map((t, i) => {
            const canEdit = isCommissioner || t.ownerUserId === user.id;
            return (
              <li key={t.id} className="rounded-xl border border-white/5 bg-ink-950/40 p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-ink-800 font-mono text-sm text-slate-300">{i + 1}</span>
                  {isCommissioner && (
                    <div className="flex flex-col">
                      <form action={moveTeamAction.bind(null, leagueId, t.id, 'up')}><button className="px-1 text-xs text-slate-500 hover:text-white" disabled={i === 0} aria-label="Move up">▲</button></form>
                      <form action={moveTeamAction.bind(null, leagueId, t.id, 'down')}><button className="px-1 text-xs text-slate-500 hover:text-white" disabled={i === teamRows.length - 1} aria-label="Move down">▼</button></form>
                    </div>
                  )}
                  {canEdit ? (
                    <ActionForm action={renameTeamAction.bind(null, leagueId, t.id)} inline>
                      <input className="input w-48" name="name" defaultValue={t.name} maxLength={40} aria-label="Team name" />
                      <SubmitButton className="btn-ghost btn-sm">Save</SubmitButton>
                    </ActionForm>
                  ) : <span className="font-medium text-white">{t.name}</span>}
                  <div className="ml-auto flex items-center gap-2 text-sm">
                    {isCommissioner ? (
                      <form action={assignOwnerAction.bind(null, leagueId, t.id)}>
                        <AutoSubmitSelect name="userId" defaultValue={t.ownerUserId ?? ''} className="input w-44" aria-label="Owner">
                          <option value="">— Open —</option>
                          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </AutoSubmitSelect>
                      </form>
                    ) : <span className="text-slate-400">{ownerName(t.ownerUserId) ?? 'Open'}</span>}
                  </div>
                </div>
                {canEdit && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 pl-11 text-xs text-slate-400">
                    <span>On-the-clock announcement{audioMode ? '' : ' (used when announcements are set to audio)'}:</span>
                    {t.announceMediaId ? (
                      <>
                        <audio controls preload="none" src={`/api/media/${t.announceMediaId}`} className="h-8" />
                        <form action={clearTeamAudioAction.bind(null, leagueId, t.id)}><SubmitButton className="btn-ghost btn-sm">Remove</SubmitButton></form>
                      </>
                    ) : (
                      <ActionForm action={uploadTeamAudioAction.bind(null, leagueId, t.id)} inline>
                        <input type="file" name="file" accept="audio/*" className="text-xs file:mr-2 file:rounded file:border-0 file:bg-ink-700 file:px-2 file:py-1 file:text-slate-200" />
                        <SubmitButton className="btn-secondary btn-sm">Upload</SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <div className="space-y-6">
        {isCommissioner && (
          <Card title="Invite a manager">
            <ActionForm action={inviteMemberAction.bind(null, leagueId)} submitLabel="Send invite">
              <Field label="Email"><input className="input" type="email" name="email" required placeholder="friend@example.com" /></Field>
              <Field label="Give them a team (optional)">
                <select name="teamId" className="input" defaultValue="">
                  <option value="">Decide later</option>
                  {teamRows.filter((t) => !t.ownerUserId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              <p className="text-xs text-slate-500">They sign in with this email and a password, and must set up two-factor authentication.</p>
            </ActionForm>
            {pending.length > 0 && (
              <div className="mt-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Pending invites</h3>
                <ul className="space-y-1 text-sm">
                  {pending.map((inv) => (
                    <li key={inv.id} className="flex items-center justify-between gap-2">
                      <span className="truncate text-slate-300">{inv.email}{inv.expiresAt < new Date() && <span className="ml-1 text-xs text-amber-300">expired</span>}</span>
                      <form action={revokeInviteAction.bind(null, leagueId, inv.id)}><SubmitButton className="btn-ghost btn-sm">Revoke</SubmitButton></form>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}

        <Card title={`Members (${members.length})`}>
          {members.length === 0 ? <Empty>No members.</Empty> : (
            <ul className="space-y-2 text-sm">
              {members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-white">{m.name} {m.role === 'commissioner' && <Badge color="violet">Commish</Badge>}</div>
                    {isCommissioner && <div className="truncate text-xs text-slate-500">{m.email}</div>}
                  </div>
                  {isCommissioner && m.id !== user.id && (
                    <div className="flex gap-1">
                      <form action={setMemberRoleAction.bind(null, leagueId, m.id, m.role === 'commissioner' ? 'member' : 'commissioner')}>
                        <SubmitButton className="btn-ghost btn-sm">{m.role === 'commissioner' ? 'Make member' : 'Make commish'}</SubmitButton>
                      </form>
                      <form action={removeMemberAction.bind(null, leagueId, m.id)}>
                        <SubmitButton className="btn-ghost btn-sm text-red-300" confirm={`Remove ${m.name} from the league?`}>Remove</SubmitButton>
                      </form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
