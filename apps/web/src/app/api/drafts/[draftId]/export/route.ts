import { EXPORT_FORMATS, exportDraft, type ExportFormat } from '@fsd/core';
import { and, asc, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { draftPicks, leagues, players, teams, users } from '@/db/schema';
import { apiUser } from '@/lib/auth';
import { leagueRole, loadDraft } from '@/lib/leagues';

export async function GET(req: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  const user = await apiUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const draft = await loadDraft(draftId);
  if (!draft || !(await leagueRole(draft.leagueId, user.id))) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const format = new URL(req.url).searchParams.get('format') as ExportFormat;
  if (!EXPORT_FORMATS.includes(format)) return NextResponse.json({ error: 'Unknown format' }, { status: 400 });

  const db = getDb();
  const [league] = await db.select().from(leagues).where(eq(leagues.id, draft.leagueId)).limit(1);
  const rows = await db.select({ pick: draftPicks, espnId: players.espnId, yahooId: players.yahooId, owner: users.displayName })
    .from(draftPicks)
    .leftJoin(players, eq(players.id, draftPicks.playerId))
    .leftJoin(teams, and(eq(teams.id, draftPicks.teamId)))
    .leftJoin(users, eq(users.id, teams.ownerUserId))
    .where(eq(draftPicks.draftId, draftId)).orderBy(asc(draftPicks.overall));
  const file = exportDraft(format, { leagueName: league?.name ?? 'league', season: draft.season, draftType: draft.config?.type ?? 'snake' },
    rows.map(({ pick, espnId, yahooId, owner }) => ({
      overall: pick.overall, round: pick.round, pickInRound: pick.pickInRound, teamName: pick.teamName, ownerName: owner,
      playerId: pick.playerId, playerName: pick.playerName, position: pick.position, nflTeam: pick.nflTeam, price: pick.price,
      isKeeper: pick.isKeeper, isAuto: pick.isAuto, espnId, yahooId,
    })));
  return new Response(file.body, {
    headers: {
      'content-type': file.contentType,
      'content-disposition': `attachment; filename="${file.filename}"`,
      'cache-control': 'no-store',
    },
  });
}
