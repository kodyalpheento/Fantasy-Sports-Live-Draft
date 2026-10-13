import { parseCsvObjects } from './csv';
import { normalizePosition, type Position } from './positions';

/** A roster as pulled from another platform or a CSV file, before matching to our player database. */
export interface ExternalRoster {
  teamName: string;
  players: ExternalPlayer[];
}

export interface ExternalPlayer {
  name: string;
  position?: string | null;
  nflTeam?: string | null;
  sleeperId?: string | null;
  espnId?: string | null;
  yahooId?: string | null;
  round?: number | null;
  cost?: number | null;
}

export interface MatchablePlayer {
  id: string;
  fullName: string;
  position: string;
  team: string | null;
  espnId: string | null;
  yahooId: string | null;
}

const SUFFIXES = /\b(jr|sr|ii|iii|iv|v)\b/g;

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/d\/st\b/g, '')
    .replace(/[.'’`-]/g, '')
    .replace(SUFFIXES, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const pick = (row: Record<string, string>, ...keys: string[]) => {
  for (const k of keys) if (row[k]) return row[k];
  return '';
};

const toInt = (v: string) => {
  const n = Number.parseInt(v.replace(/[$,]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

/**
 * Parse a roster CSV. Header names are flexible; recognised columns:
 * Team, Player, Position, NFL Team, Round, Cost/Price/Salary, Sleeper ID, ESPN ID, Yahoo ID.
 */
export function parseRosterCsv(text: string): ExternalRoster[] {
  const rows = parseCsvObjects(text);
  const byTeam = new Map<string, ExternalRoster>();
  for (const row of rows) {
    const teamName = pick(row, 'team', 'team name', 'fantasy team', 'owner', 'manager');
    const name = pick(row, 'player', 'player name', 'name', 'full name');
    if (!teamName || !name) continue;
    let roster = byTeam.get(teamName);
    if (!roster) byTeam.set(teamName, (roster = { teamName, players: [] }));
    roster.players.push({
      name,
      position: pick(row, 'position', 'pos') || null,
      nflTeam: pick(row, 'nfl team', 'nfl', 'pro team', 'team abbr') || null,
      sleeperId: pick(row, 'sleeper id', 'sleeper player id', 'player id') || null,
      espnId: pick(row, 'espn id', 'espn player id') || null,
      yahooId: pick(row, 'yahoo id', 'yahoo player id') || null,
      round: toInt(pick(row, 'round', 'keeper round')),
      cost: toInt(pick(row, 'cost', 'price', 'salary', 'amount', 'bid')),
    });
  }
  return [...byTeam.values()];
}

/** Match external players onto our player records: platform IDs first, then name + position (+ NFL team). */
export function matchExternalPlayers(
  external: ExternalPlayer[],
  players: MatchablePlayer[],
): { matched: { external: ExternalPlayer; playerId: string }[]; unmatched: ExternalPlayer[] } {
  const byId = new Map(players.map((p) => [p.id, p]));
  const byEspn = new Map(players.filter((p) => p.espnId).map((p) => [p.espnId!, p]));
  const byYahoo = new Map(players.filter((p) => p.yahooId).map((p) => [p.yahooId!, p]));
  const byName = new Map<string, MatchablePlayer[]>();
  for (const p of players) {
    const key = normalizeName(p.fullName);
    byName.set(key, [...(byName.get(key) ?? []), p]);
    // Team defenses are often listed by nickname only ("Bears D/ST").
    if (p.position === 'DST') {
      const nick = normalizeName(p.fullName.split(' ').pop() ?? '');
      byName.set(nick, [...(byName.get(nick) ?? []), p]);
    }
  }

  const matched: { external: ExternalPlayer; playerId: string }[] = [];
  const unmatched: ExternalPlayer[] = [];
  for (const ext of external) {
    let hit = (ext.sleeperId && byId.get(ext.sleeperId)) || (ext.espnId && byEspn.get(ext.espnId)) ||
      (ext.yahooId && byYahoo.get(ext.yahooId)) || undefined;
    if (!hit) {
      let candidates = byName.get(normalizeName(ext.name)) ?? [];
      const pos: Position | undefined = normalizePosition(ext.position)?.position;
      if (candidates.length > 1 && pos) {
        const samePos = candidates.filter((c) => normalizePosition(c.position)?.position === pos);
        if (samePos.length) candidates = samePos;
      }
      if (candidates.length > 1 && ext.nflTeam) {
        const sameTeam = candidates.filter((c) => c.team?.toUpperCase() === ext.nflTeam!.toUpperCase());
        if (sameTeam.length) candidates = sameTeam;
      }
      hit = candidates[0];
    }
    if (hit) matched.push({ external: ext, playerId: hit.id });
    else unmatched.push(ext);
  }
  return { matched, unmatched };
}

/** Pair external teams with local teams: exact (normalised) name first, then remaining teams in order. */
export function mapTeams<T extends { id: string; name: string }>(external: ExternalRoster[], local: T[]): Map<ExternalRoster, T> {
  const out = new Map<ExternalRoster, T>();
  const free = [...local];
  for (const ext of external) {
    const idx = free.findIndex((t) => normalizeName(t.name) === normalizeName(ext.teamName));
    if (idx >= 0) out.set(ext, free.splice(idx, 1)[0]);
  }
  for (const ext of external) {
    if (out.has(ext) || !free.length) continue;
    out.set(ext, free.shift()!);
  }
  return out;
}
