import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Badge, Card, Empty, Field } from '@/components/ui';
import { getDb } from '@/db';
import { players, rosterEntries } from '@/db/schema';
import { currentSeason, leagueTeams, requireLeague } from '@/lib/leagues';
import {
  addRosterEntryAction, clearRostersAction, importRostersAction, latestDraftSeason, removeRosterEntryAction, searchPlayersAction,
  updateRosterEntryAction,
} from '../../actions';
import { ImportForm, PlayerSearch } from './client';

export default async function KeepersPage({ params, searchParams }: { params: Promise<{ leagueId: string }>; searchParams: Promise<{ season?: string }> }) {
  const { leagueId } = await params;
  const sp = await searchParams;
  const { config, isCommissioner } = await requireLeague(leagueId);
  const season = Number(sp.season) || (await latestDraftSeason(leagueId));
  const style = config.league.leagueStyle;
  const auction = config.draft.type === 'auction';
  const db = getDb();
  const [teamRows, entries] = await Promise.all([
    leagueTeams(leagueId),
    db.select({ entry: rosterEntries, player: players }).from(rosterEntries)
      .innerJoin(players, eq(players.id, rosterEntries.playerId))
      .where(and(eq(rosterEntries.leagueId, leagueId), eq(rosterEntries.season, season))),
  ]);

  const explainer = style === 'keeper'
    ? `Each team may keep up to ${config.league.maxKeepers} player(s). Tick "Keep" and set the ${auction ? 'cost (deducted from the auction budget)' : 'round whose pick the keeper uses'}. Unticked players go back into the draft pool.`
    : style === 'dynasty'
      ? 'Dynasty rosters carry over: every player listed here is off the board, and the draft only fills out rosters (usually rookies). Tick "Keep" with a round only if that player should use a draft pick.'
      : 'Redraft leagues start from scratch each season. Anything ticked "Keep" here is still honored as a keeper.';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-400">Season:</span>
          {[season - 1, season, season + 1].map((y) => (
            <Link key={y} href={`?season=${y}`} className={`btn-sm btn ${y === season ? 'bg-brand-500 text-ink-950' : 'btn-secondary'}`}>{y}</Link>
          ))}
          {season !== currentSeason() && <Link href={`?season=${currentSeason()}`} className="btn-ghost btn-sm">This season</Link>}
        </div>
        <p className="text-sm text-slate-400">{explainer}</p>
        {teamRows.map((t) => {
          const rows = entries.filter((e) => e.entry.teamId === t.id).sort((a, b) => (a.player.rank ?? 1e9) - (b.player.rank ?? 1e9));
          const keepers = rows.filter((r) => r.entry.isKeeper).length;
          const over = style === 'keeper' && keepers > config.league.maxKeepers;
          return (
            <Card key={t.id} title={<span className="flex items-center gap-2">{t.name} <Badge color={over ? 'red' : 'slate'}>{keepers} kept{style === 'keeper' ? ` / ${config.league.maxKeepers}` : ''}</Badge></span>}>
              {rows.length === 0 ? <p className="text-sm text-slate-500">No players.</p> : (
                <ul className="divide-y divide-white/5">
                  {rows.map(({ entry, player }) => (
                    <li key={entry.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate"><span className="font-medium text-white">{player.fullName}</span> <span className="text-slate-400">{player.position} · {player.team ?? 'FA'}</span></span>
                      {isCommissioner ? (
                        <form action={updateRosterEntryAction.bind(null, leagueId, entry.id)} className="flex items-center gap-2">
                          <label className="flex items-center gap-1 text-xs text-slate-300"><input type="checkbox" name="isKeeper" defaultChecked={entry.isKeeper} className="accent-emerald-500" /> Keep</label>
                          {auction
                            ? <input className="input w-20 py-1" name="cost" type="number" min={0} placeholder="$" defaultValue={entry.cost ?? ''} aria-label="Cost" />
                            : <input className="input w-20 py-1" name="round" type="number" min={1} placeholder="Rd" defaultValue={entry.round ?? ''} aria-label="Round" />}
                          <SubmitButton className="btn-ghost btn-sm">Save</SubmitButton>
                        </form>
                      ) : (
                        entry.isKeeper && <Badge color="green">Keeper{entry.round ? ` · Rd ${entry.round}` : ''}{entry.cost != null ? ` · $${entry.cost}` : ''}</Badge>
                      )}
                      {isCommissioner && (
                        <form action={removeRosterEntryAction.bind(null, leagueId, entry.id)}><SubmitButton className="btn-ghost btn-sm text-red-300">✕</SubmitButton></form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      {isCommissioner ? (
        <aside className="space-y-6">
          <Card title="Add a player">
            <ActionForm action={addRosterEntryAction.bind(null, leagueId, season)} submitLabel="Add">
              <Field label="Team">
                <select name="teamId" className="input" required>{teamRows.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              </Field>
              <Field label="Player"><PlayerSearch search={searchPlayersAction} /></Field>
              <div className="grid grid-cols-2 gap-3">
                {auction
                  ? <Field label="Keeper cost"><input className="input" name="cost" type="number" min={0} /></Field>
                  : <Field label="Keeper round"><input className="input" name="round" type="number" min={1} /></Field>}
              </div>
            </ActionForm>
          </Card>
          <Card title="Import rosters">
            <p className="mb-3 text-sm text-slate-400">Pull last season&apos;s rosters in, then choose keepers. Teams are matched by name, then by order.</p>
            <ImportForm action={importRostersAction.bind(null, leagueId)} season={season} />
          </Card>
          {entries.length > 0 && (
            <form action={clearRostersAction.bind(null, leagueId, season)}>
              <SubmitButton className="btn-danger btn-sm" confirm={`Remove every ${season} roster entry?`}>Clear {season} rosters</SubmitButton>
            </form>
          )}
        </aside>
      ) : entries.length === 0 ? <Empty>The commissioner hasn&apos;t entered any rosters for {season}.</Empty> : null}
    </div>
  );
}
