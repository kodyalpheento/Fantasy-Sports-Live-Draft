/** Sleeper player feed → our player rows. No server-only imports, so CLI scripts can use it too. */
import { normalizePosition } from '@fsd/core';
import type { players } from '@/db/schema';

export const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl';

export interface SleeperPlayer {
  player_id?: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  fantasy_positions?: string[] | null;
  team?: string | null;
  age?: number | null;
  years_exp?: number | null;
  search_rank?: number | null;
  status?: string | null;
  injury_status?: string | null;
  active?: boolean | null;
  espn_id?: string | number | null;
  yahoo_id?: string | number | null;
}

export function headshotFor(id: string, position: string): string {
  return position === 'DST'
    ? `https://sleepercdn.com/images/team_logos/nfl/${id.toLowerCase()}.png`
    : `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`;
}

/** Convert Sleeper's player record into ours. Returns null for positions we don't draft or long-gone players. */
export function fromSleeper(id: string, p: SleeperPlayer): typeof players.$inferInsert | null {
  const norm = normalizePosition(p.position === 'DEF' ? 'DST' : p.position);
  if (!norm) return null;
  const rookie = p.years_exp === 0;
  const isDst = norm.position === 'DST';
  if (!isDst && !p.active && !rookie) return null;
  const extra = (p.fantasy_positions ?? []).map((fp) => normalizePosition(fp)?.position).filter((x): x is NonNullable<typeof x> => !!x);
  const positions = [...new Set([...norm.positions, ...extra])];
  const fullName = isDst
    ? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || id
    : p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  if (!fullName) return null;
  const rank = p.search_rank != null && p.search_rank < 9_000_000 ? p.search_rank : null;
  return {
    id,
    fullName,
    firstName: p.first_name ?? null,
    lastName: p.last_name ?? null,
    position: norm.position,
    positions,
    team: isDst ? id : (p.team ?? null),
    rank,
    age: p.age ?? null,
    yearsExp: p.years_exp ?? null,
    rookie,
    status: p.status ?? null,
    injuryStatus: p.injury_status ?? null,
    espnId: p.espn_id != null ? String(p.espn_id) : null,
    yahooId: p.yahoo_id != null ? String(p.yahoo_id) : null,
    headshotUrl: headshotFor(id, norm.position),
    active: true,
    updatedAt: new Date(),
  };
}

