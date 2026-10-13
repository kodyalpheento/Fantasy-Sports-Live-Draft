import 'server-only';
import { eligiblePositions, type DraftSettings, type LeagueSettings, type PoolPlayer } from '@fsd/core';
import { eq, notInArray, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { appState, players, type PlayerRow } from '@/db/schema';
import { SLEEPER_PLAYERS_URL, fromSleeper, type SleeperPlayer } from './sleeper';

export { headshotFor } from './sleeper';

export const PLAYER_SYNC_KEY = 'player_sync';
/** Sleeper asks clients to fetch the full player list at most about once a day. */
const SYNC_INTERVAL_MS = 20 * 3600_000;

export interface SyncStatus {
  at: string;
  ok: boolean;
  count?: number;
  error?: string;
}

/** Pull the full NFL player list (positions, teams, headshots, rankings) from Sleeper and upsert it. */
export async function syncPlayersFromSleeper(): Promise<SyncStatus> {
  const db = getDb();
  let status: SyncStatus;
  try {
    const res = await fetch(SLEEPER_PLAYERS_URL, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Sleeper responded ${res.status}`);
    const data = (await res.json()) as Record<string, SleeperPlayer>;
    const rows = Object.entries(data).map(([id, p]) => fromSleeper(id, p)).filter((r): r is NonNullable<typeof r> => !!r);
    if (rows.length < 500) throw new Error(`Only ${rows.length} usable players returned; refusing to update.`);
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await db.insert(players).values(chunk).onConflictDoUpdate({
        target: players.id,
        set: {
          fullName: sql`excluded.full_name`, firstName: sql`excluded.first_name`, lastName: sql`excluded.last_name`,
          position: sql`excluded.position`, positions: sql`excluded.positions`, team: sql`excluded.team`,
          rank: sql`excluded.rank`, age: sql`excluded.age`, yearsExp: sql`excluded.years_exp`, rookie: sql`excluded.rookie`,
          status: sql`excluded.status`, injuryStatus: sql`excluded.injury_status`, espnId: sql`excluded.espn_id`,
          yahooId: sql`excluded.yahoo_id`, headshotUrl: sql`excluded.headshot_url`, active: sql`true`, updatedAt: sql`now()`,
        },
      });
    }
    await db.update(players).set({ active: false }).where(notInArray(players.id, rows.map((r) => r.id)));
    status = { at: new Date().toISOString(), ok: true, count: rows.length };
  } catch (err) {
    status = { at: new Date().toISOString(), ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  await db.insert(appState).values({ key: PLAYER_SYNC_KEY, value: status })
    .onConflictDoUpdate({ target: appState.key, set: { value: status, updatedAt: new Date() } });
  return status;
}

export async function lastPlayerSync(): Promise<SyncStatus | null> {
  const [row] = await getDb().select().from(appState).where(eq(appState.key, PLAYER_SYNC_KEY)).limit(1);
  return (row?.value as SyncStatus | undefined) ?? null;
}

export async function syncPlayersIfStale(): Promise<SyncStatus | null> {
  const last = await lastPlayerSync();
  if (last?.ok && Date.now() - Date.parse(last.at) < SYNC_INTERVAL_MS) return null;
  // After a failure, retry at most hourly.
  if (last && !last.ok && Date.now() - Date.parse(last.at) < 3600_000) return null;
  return syncPlayersFromSleeper();
}

export function toPoolPlayer(p: PlayerRow): PoolPlayer {
  return {
    id: p.id, name: p.fullName, position: p.position, positions: p.positions, team: p.team, rank: p.rank,
    rookie: p.rookie, headshot: p.headshotUrl,
  };
}

/** The draftable player pool for a league's settings. */
export async function draftPool(league: LeagueSettings, draft: DraftSettings): Promise<PoolPlayer[]> {
  const allowed = eligiblePositions(league.rosterSlots);
  const rows = await getDb().select().from(players).where(eq(players.active, true));
  return rows
    .filter((p) => p.positions.some((pos) => allowed.has(pos)))
    .filter((p) => (draft.playerPool === 'rookies' ? p.rookie : true))
    .filter((p) => p.position === 'DST' || p.rookie || (p.team != null && p.rank != null))
    .map(toPoolPlayer)
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
}
