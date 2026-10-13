import 'server-only';
import { normalizeLeagueConfig } from '@fsd/core';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { leagueMembers, leagues, users, type Draft } from '@/db/schema';
import type { TeamMeta } from '@/components/draft/shared';
import { draftLabel, leagueTeams } from './leagues';

/** What the draft room and board pages need from the database (live state comes over the socket). */
export async function draftPageData(draft: Draft) {
  const db = getDb();
  const [league] = await db.select().from(leagues).where(eq(leagues.id, draft.leagueId)).limit(1);
  const teamRows = await leagueTeams(draft.leagueId);
  const owners = await db.select({ id: users.id, name: users.displayName }).from(leagueMembers)
    .innerJoin(users, eq(users.id, leagueMembers.userId)).where(eq(leagueMembers.leagueId, draft.leagueId));
  const teamMeta: Record<string, TeamMeta> = Object.fromEntries(teamRows.map((t) => [t.id, {
    announceMediaId: t.announceMediaId,
    ownerName: owners.find((o) => o.id === t.ownerUserId)?.name ?? null,
  }]));
  return {
    leagueName: league?.name ?? 'League',
    settings: normalizeLeagueConfig(league?.settings).draft,
    teamMeta,
    title: draftLabel(draft),
  };
}
