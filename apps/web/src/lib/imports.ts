import 'server-only';
import type { ExternalRoster } from '@fsd/core';

async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { accept: 'application/json', ...headers } });
  if (!res.ok) throw new Error(`${new URL(url).hostname} responded ${res.status}`);
  return (await res.json()) as T;
}

/** Sleeper's public API: rosters + users for a league ID (no auth needed). Player IDs are Sleeper IDs, same as ours. */
export async function fetchSleeperRosters(leagueId: string): Promise<ExternalRoster[]> {
  if (!/^\d{5,25}$/.test(leagueId)) throw new Error('Sleeper league IDs are numbers (see the league URL).');
  const base = `https://api.sleeper.app/v1/league/${leagueId}`;
  const [rosters, users] = await Promise.all([
    getJson<{ owner_id: string | null; roster_id: number; players: string[] | null; keepers?: string[] | null }[]>(`${base}/rosters`),
    getJson<{ user_id: string; display_name: string; metadata?: { team_name?: string } }[]>(`${base}/users`),
  ]);
  const byUser = new Map(users.map((u) => [u.user_id, u]));
  return rosters
    .sort((a, b) => a.roster_id - b.roster_id)
    .map((r) => {
      const u = r.owner_id ? byUser.get(r.owner_id) : undefined;
      return {
        teamName: u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`,
        players: (r.players ?? []).map((id) => ({ name: id, sleeperId: id })),
      };
    });
}

interface EspnLeague {
  teams?: {
    id: number;
    name?: string;
    location?: string;
    nickname?: string;
    roster?: { entries?: { playerId: number; playerPoolEntry?: { player?: { fullName?: string; defaultPositionId?: number } } }[] };
  }[];
}

const ESPN_POSITIONS: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DST', 9: 'DL', 10: 'LB', 11: 'DL', 12: 'DB', 13: 'DB', 14: 'DB' };

/**
 * ESPN's fantasy API. Public leagues work as-is; private leagues need the `espn_s2` and `SWID` cookies
 * from a signed-in browser session (they are used for this request only and never stored).
 */
export async function fetchEspnRosters(leagueId: string, season: number, espnS2?: string, swid?: string): Promise<ExternalRoster[]> {
  if (!/^\d{1,20}$/.test(leagueId)) throw new Error('ESPN league IDs are numbers (leagueId= in the league URL).');
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}?view=mTeam&view=mRoster`;
  const headers: Record<string, string> = {};
  if (espnS2 && swid) headers.cookie = `espn_s2=${espnS2}; SWID=${swid}`;
  const data = await getJson<EspnLeague>(url, headers);
  if (!data.teams?.length) throw new Error('No teams returned. Private leagues need the espn_s2 and SWID cookies.');
  return data.teams.map((t) => ({
    teamName: t.name || `${t.location ?? ''} ${t.nickname ?? ''}`.trim() || `Team ${t.id}`,
    players: (t.roster?.entries ?? []).map((e) => ({
      name: e.playerPoolEntry?.player?.fullName ?? String(e.playerId),
      position: ESPN_POSITIONS[e.playerPoolEntry?.player?.defaultPositionId ?? 0] ?? null,
      espnId: e.playerId > 0 ? String(e.playerId) : null,
    })),
  }));
}
