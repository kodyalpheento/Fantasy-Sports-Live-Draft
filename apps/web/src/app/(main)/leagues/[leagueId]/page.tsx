import { and, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { CopyButton, LocalDateTimeInput, LocalTime } from '@/components/client-inputs';
import { Badge, Card, Empty, Field } from '@/components/ui';
import { getDb } from '@/db';
import { drafts, leagueMembers, users } from '@/db/schema';
import { STATUS_LABEL, currentSeason, leagueTeams, requireLeague } from '@/lib/leagues';
import { deleteDraftAction, resetDraftAction, scheduleDraftAction, startMockDraftAction } from '../actions';

const STATUS_COLOR = { scheduled: 'blue', in_progress: 'red', paused: 'amber', completed: 'green' } as const;

export default async function LeagueOverview({ params }: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  const { config, isCommissioner } = await requireLeague(leagueId);
  const db = getDb();
  const [draftRows, teamRows, members] = await Promise.all([
    db.select().from(drafts).where(eq(drafts.leagueId, leagueId)).orderBy(desc(drafts.season), desc(drafts.createdAt)),
    leagueTeams(leagueId),
    db.select({ id: users.id, name: users.displayName }).from(leagueMembers).innerJoin(users, eq(users.id, leagueMembers.userId))
      .where(and(eq(leagueMembers.leagueId, leagueId))),
  ]);
  const real = draftRows.filter((d) => !d.isMock);
  const mocks = draftRows.filter((d) => d.isMock);
  const nameOf = (id: string | null) => members.find((m) => m.id === id)?.name;
  const upcoming = real.find((d) => d.status !== 'completed');

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card title="Drafts">
          {real.length === 0 ? (
            <Empty>No drafts yet.{isCommissioner && ' Schedule one to get started.'}</Empty>
          ) : (
            <ul className="divide-y divide-white/5">
              {real.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <div className="flex items-center gap-2 font-medium text-white">
                      {d.season} draft <Badge color={STATUS_COLOR[d.status]}>{STATUS_LABEL[d.status]}</Badge>
                    </div>
                    <div className="text-sm text-slate-400">
                      {d.status === 'completed' ? <>Completed <LocalTime iso={d.completedAt?.toISOString() ?? null} /></> : <>Scheduled <LocalTime iso={d.scheduledAt?.toISOString() ?? null} /></>}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {d.status === 'completed' ? (
                      <Link className="btn-secondary btn-sm" href={`/leagues/${leagueId}/history?draft=${d.id}`}>Results</Link>
                    ) : (
                      <Link className="btn-primary btn-sm" href={`/drafts/${d.id}`}>{d.status === 'scheduled' ? 'Open draft room' : 'Join live draft'}</Link>
                    )}
                    <Link className="btn-secondary btn-sm" href={`/board/${d.id}`} target="_blank">Board view</Link>
                    {isCommissioner && <CopyButton text={`/board/${d.id}?key=${d.viewKey}`} label="Copy TV link" />}
                    {isCommissioner && d.status !== 'scheduled' && (
                      <ActionForm action={resetDraftAction.bind(null, leagueId, d.id)} submitLabel="Reset" submitClassName="btn-danger btn-sm" inline
                        confirm="Reset this draft? Every pick will be deleted and the room rebuilt from the current settings." />
                    )}
                    {isCommissioner && (
                      <form action={deleteDraftAction.bind(null, leagueId, d.id)}>
                        <SubmitButton className="btn-ghost btn-sm" confirm="Delete this draft and its results?">Delete</SubmitButton>
                      </form>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {isCommissioner && (
            <div className="mt-5 rounded-xl border border-white/5 bg-ink-950/40 p-4">
              <h3 className="mb-3 text-sm font-semibold text-white">{upcoming ? `Change the ${upcoming.season} draft date` : 'Schedule a draft'}</h3>
              <ActionForm action={scheduleDraftAction.bind(null, leagueId)} submitLabel={upcoming ? 'Save date' : 'Schedule draft'} className="grid items-end gap-3 sm:grid-cols-[120px_1fr_auto]">
                <Field label="Season"><input className="input" name="season" type="number" defaultValue={upcoming?.season ?? currentSeason()} min={2000} max={2100} /></Field>
                <Field label="Date & time (optional)"><LocalDateTimeInput name="scheduledAt" defaultValue={upcoming?.scheduledAt?.toISOString()} /></Field>
              </ActionForm>
            </div>
          )}
        </Card>

        {isCommissioner && (
          <Card title="Mock drafts" actions={
            <form action={startMockDraftAction.bind(null, leagueId)}><SubmitButton className="btn-secondary btn-sm">Start a mock draft</SubmitButton></form>
          }>
            <p className="mb-3 text-sm text-slate-400">
              Test your settings before draft night. Every team you don&apos;t own is put on autopick. Mock drafts never count as league history.
            </p>
            {mocks.length === 0 ? <Empty>No mock drafts yet.</Empty> : (
              <ul className="divide-y divide-white/5">
                {mocks.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-slate-300">Mock · <LocalTime iso={d.createdAt.toISOString()} /> <Badge color={STATUS_COLOR[d.status]}>{STATUS_LABEL[d.status]}</Badge></span>
                    <span className="flex gap-2">
                      <Link className="btn-secondary btn-sm" href={`/drafts/${d.id}`}>Open</Link>
                      <form action={deleteDraftAction.bind(null, leagueId, d.id)}><SubmitButton className="btn-ghost btn-sm">Delete</SubmitButton></form>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <Card title="Draft order" actions={<Link href={`/leagues/${leagueId}/members`} className="text-sm text-brand-400 hover:underline">Manage</Link>}>
        <ol className="space-y-1.5">
          {teamRows.map((t, i) => (
            <li key={t.id} className="flex items-center gap-3 rounded-lg bg-ink-950/40 px-3 py-2 text-sm">
              <span className="w-6 text-right font-mono text-slate-500">{i + 1}</span>
              <span className="flex-1 truncate font-medium text-white">{t.name}</span>
              <span className="truncate text-xs text-slate-400">{nameOf(t.ownerUserId) ?? 'Open'}</span>
            </li>
          ))}
        </ol>
        <dl className="mt-5 grid grid-cols-2 gap-2 text-sm">
          <div><dt className="text-xs text-slate-500">Rounds</dt><dd className="text-white">{config.draft.type === 'auction' ? `$${config.draft.auction.budget} budget` : config.draft.rounds}</dd></div>
          <div><dt className="text-xs text-slate-500">Pick clock</dt><dd className="text-white">{config.draft.pickTimeSeconds ? `${config.draft.pickTimeSeconds}s` : 'None'}</dd></div>
          <div><dt className="text-xs text-slate-500">Who picks</dt><dd className="text-white">{config.draft.selectionMode === 'members' ? 'Each manager' : 'Commissioner'}</dd></div>
          <div><dt className="text-xs text-slate-500">Scoring</dt><dd className="uppercase text-white">{config.league.scoring.replace('_', ' ')}</dd></div>
        </dl>
      </Card>
    </div>
  );
}
