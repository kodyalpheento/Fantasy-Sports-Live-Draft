import { buildSlots, EXPORT_FORMAT_LABELS, EXPORT_FORMATS, normalizeLeagueConfig } from '@fsd/core';
import { and, asc, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { DraftBoard } from '@/components/draft/board';
import { Card, Empty, formatDate } from '@/components/ui';
import { getDb } from '@/db';
import { draftPicks, drafts, players } from '@/db/schema';
import { leagueTeams, requireLeague } from '@/lib/leagues';

export default async function HistoryPage({ params, searchParams }: { params: Promise<{ leagueId: string }>; searchParams: Promise<{ draft?: string }> }) {
  const { leagueId } = await params;
  const sp = await searchParams;
  const { league } = await requireLeague(leagueId);
  const db = getDb();
  const completed = await db.select().from(drafts)
    .where(and(eq(drafts.leagueId, leagueId), eq(drafts.isMock, false), eq(drafts.status, 'completed')))
    .orderBy(desc(drafts.season), desc(drafts.completedAt));
  if (!completed.length) return <Empty>No completed drafts yet. Results show up here after each draft.</Empty>;

  const selected = completed.find((d) => d.id === sp.draft) ?? completed[0];
  const picks = await db.select({ pick: draftPicks, headshot: players.headshotUrl }).from(draftPicks)
    .leftJoin(players, eq(players.id, draftPicks.playerId))
    .where(eq(draftPicks.draftId, selected.id)).orderBy(asc(draftPicks.overall));
  const config = selected.config;
  const teams = config?.teams ?? (await leagueTeams(leagueId)).map((t) => ({ id: t.id, name: t.name }));
  const type = config?.type ?? 'snake';
  const rounds = config?.rounds ?? Math.max(1, ...picks.map((p) => p.pick.round));
  const colors = normalizeLeagueConfig(league.settings).draft.positionColors;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {completed.map((d) => (
          <Link key={d.id} href={`?draft=${d.id}`} className={`btn-sm btn ${d.id === selected.id ? 'bg-brand-500 text-ink-950' : 'btn-secondary'}`}>{d.season}</Link>
        ))}
      </div>
      <Card
        title={`${selected.season} draft · ${formatDate(selected.completedAt, { dateStyle: 'long' })}`}
        actions={
          <details className="relative">
            <summary className="btn-secondary btn-sm cursor-pointer list-none">Export ▾</summary>
            <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-white/10 bg-ink-850 p-1 shadow-xl">
              {EXPORT_FORMATS.map((f) => (
                <a key={f} href={`/api/drafts/${selected.id}/export?format=${f}`} className="block rounded px-3 py-2 text-sm text-slate-200 hover:bg-white/5">{EXPORT_FORMAT_LABELS[f]}</a>
              ))}
              <p className="px-3 py-2 text-[11px] leading-snug text-slate-500">
                ESPN, Sleeper and Yahoo don&apos;t offer a draft-results upload API. Each file lists picks in order with that platform&apos;s player IDs, ready for its offline-draft entry screen.
              </p>
            </div>
          </details>
        }
      >
        <DraftBoard
          teams={teams}
          type={type}
          rounds={rounds}
          slots={type === 'auction' ? undefined : buildSlots({ type, rounds, teams, thirdRoundReversal: config?.thirdRoundReversal ?? false })}
          colors={colors}
          picks={picks.map(({ pick, headshot }) => ({
            overall: pick.overall, round: pick.round, pickInRound: pick.pickInRound, teamId: pick.teamId, playerName: pick.playerName,
            position: pick.position, nflTeam: pick.nflTeam, price: pick.price, isKeeper: pick.isKeeper, isAuto: pick.isAuto, headshot,
          }))}
        />
      </Card>
    </div>
  );
}
