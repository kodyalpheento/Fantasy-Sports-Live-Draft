import 'server-only';
import {
  normalizeLeagueConfig, signRealtimeToken, type DraftConfig, type DraftInitRequest, type Keeper, type RealtimeTokenPayload,
} from '@fsd/core';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { drafts, leagues, players, rosterEntries, type Draft } from '@/db/schema';
import { cfEnv } from './cf';
import { leagueTeams } from './leagues';
import { draftPool, toPoolPlayer } from './players';

const TOKEN_TTL_MS = 12 * 3600_000;

function secret(): string {
  const s = process.env.REALTIME_SECRET;
  if (!s) throw new Error('REALTIME_SECRET is not set');
  return s;
}

export function realtimeUrl(): string {
  return (process.env.REALTIME_URL ?? 'http://localhost:8787').replace(/\/$/, '');
}

/** Public WebSocket base URL browsers connect to. */
export function realtimeWsUrl(): string {
  return realtimeUrl().replace(/^http/, 'ws');
}

async function callRealtime(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${secret()}`);
  headers.set('content-type', 'application/json');
  const binding = cfEnv()?.REALTIME;
  const url = `${realtimeUrl()}${path}`;
  return binding ? binding.fetch(url, { ...init, headers }) : fetch(url, { ...init, headers });
}

/** Freeze the league's current settings, teams, keepers and player pool into a draft room. */
export async function initDraftRoom(draft: Draft, opts: { force?: boolean; commissionerId?: string } = {}) {
  const db = getDb();
  const [league] = await db.select().from(leagues).where(eq(leagues.id, draft.leagueId)).limit(1);
  if (!league) throw new Error('League not found');
  const cfg = normalizeLeagueConfig(league.settings);
  const teamRows = await leagueTeams(league.id);
  if (teamRows.length < 2) throw new Error('A draft needs at least two teams.');

  const entries = await db.select().from(rosterEntries)
    .where(and(eq(rosterEntries.leagueId, league.id), eq(rosterEntries.season, draft.season)));
  const dynasty = cfg.league.leagueStyle === 'dynasty';
  const teamIds = new Set(teamRows.map((t) => t.id));
  const keepers: Keeper[] = entries
    .filter((e) => teamIds.has(e.teamId) && (dynasty || e.isKeeper))
    .map((e) => ({
      teamId: e.teamId,
      playerId: e.playerId,
      // Dynasty rosters carry over without using picks; keepers use their round/cost.
      round: dynasty && !e.isKeeper ? null : e.round,
      cost: dynasty && !e.isKeeper ? null : e.cost,
    }));

  const config: DraftConfig = {
    draftId: draft.id,
    type: cfg.draft.type,
    rounds: cfg.draft.rounds,
    teams: teamRows.map((t) => ({ id: t.id, name: t.name })),
    rosterSlots: cfg.league.rosterSlots,
    pickTimeSeconds: cfg.draft.pickTimeSeconds,
    autopickOnTimeout: cfg.draft.autopickOnTimeout,
    thirdRoundReversal: cfg.draft.thirdRoundReversal,
    selectionMode: cfg.draft.selectionMode,
    auction: cfg.draft.auction,
    keepers,
    ignoreRosterCaps: cfg.draft.playerPool === 'rookies',
  };

  const pool = await draftPool(cfg.league, cfg.draft);
  // Keepers must be draftable-pool members so they show on the board even if filtered out (e.g. a veteran in a rookie draft).
  const poolIds = new Set(pool.map((p) => p.id));
  const missing = keepers.map((k) => k.playerId).filter((id) => !poolIds.has(id));
  if (missing.length) {
    const extra = await db.select().from(players).where(inArray(players.id, missing));
    pool.push(...extra.map(toPoolPlayer));
  }

  // Mock drafts: every team the commissioner doesn't own drafts itself.
  const autopickTeams = draft.isMock
    ? teamRows.filter((t) => t.ownerUserId !== opts.commissionerId).map((t) => t.id)
    : [];

  const body: DraftInitRequest = { config, players: pool, autopickTeams, force: opts.force };
  const res = await callRealtime(`/drafts/${draft.id}/init`, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Realtime service error (${res.status}): ${await res.text()}`);
  const result = (await res.json()) as { initialized: boolean };

  if (result.initialized || !draft.initializedAt) {
    await db.update(drafts).set({ config, initializedAt: new Date() }).where(eq(drafts.id, draft.id));
  }
  return result;
}

export async function issueRealtimeToken(payload: Omit<RealtimeTokenPayload, 'exp'>): Promise<string> {
  return signRealtimeToken({ ...payload, exp: Date.now() + TOKEN_TTL_MS }, secret());
}
