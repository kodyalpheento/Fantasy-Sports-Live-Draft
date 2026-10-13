import 'server-only';
import { normalizeLeagueConfig, type LeagueConfig } from '@fsd/core';
import { and, asc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb } from '@/db';
import { drafts, leagueMembers, leagues, teams, type Draft, type League, type Team, type User } from '@/db/schema';
import { requireUser } from './auth';

export type LeagueRole = 'commissioner' | 'member';

export interface LeagueAccess {
  user: User;
  league: League;
  config: LeagueConfig;
  role: LeagueRole;
  isCommissioner: boolean;
}

export const SPORTS = [
  { id: 'nfl', name: 'Football', league: 'NFL', available: true, emoji: '🏈' },
  { id: 'nba', name: 'Basketball', league: 'NBA', available: false, emoji: '🏀' },
  { id: 'mlb', name: 'Baseball', league: 'MLB', available: false, emoji: '⚾' },
  { id: 'nhl', name: 'Hockey', league: 'NHL', available: false, emoji: '🏒' },
] as const;

/** Fantasy football season for "now": drafts happen in late summer, so Jan–Feb still belong to last season. */
export function currentSeason(now = new Date()): number {
  return now.getMonth() < 2 ? now.getFullYear() - 1 : now.getFullYear();
}

export async function leagueRole(leagueId: string, userId: string): Promise<LeagueRole | null> {
  const [m] = await getDb().select({ role: leagueMembers.role }).from(leagueMembers)
    .where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, userId))).limit(1);
  return m?.role ?? null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID.test(s);

/** Load a league the current user belongs to (404 otherwise). Throws if `commissioner` is required and missing. */
export async function requireLeague(leagueId: string, opts: { commissioner?: boolean } = {}): Promise<LeagueAccess> {
  const user = await requireUser();
  if (!isUuid(leagueId)) notFound();
  const [league] = await getDb().select().from(leagues).where(eq(leagues.id, leagueId)).limit(1);
  if (!league) notFound();
  const role = await leagueRole(leagueId, user.id);
  if (!role) notFound();
  if (opts.commissioner && role !== 'commissioner') throw new Error('Only a commissioner can do that.');
  return { user, league, config: normalizeLeagueConfig(league.settings), role, isCommissioner: role === 'commissioner' };
}

export async function leagueTeams(leagueId: string): Promise<Team[]> {
  return getDb().select().from(teams).where(eq(teams.leagueId, leagueId)).orderBy(asc(teams.draftOrder), asc(teams.createdAt));
}

export async function loadDraft(draftId: string): Promise<Draft | null> {
  if (!isUuid(draftId)) return null;
  const [d] = await getDb().select().from(drafts).where(eq(drafts.id, draftId)).limit(1);
  return d ?? null;
}

export function draftLabel(d: Pick<Draft, 'season' | 'isMock'>): string {
  return d.isMock ? `${d.season} mock draft` : `${d.season} draft`;
}

export const STATUS_LABEL: Record<Draft['status'], string> = {
  scheduled: 'Scheduled',
  in_progress: 'Live',
  paused: 'Paused',
  completed: 'Complete',
};
