import { rosterSize } from './positions';
import type { DraftConfig, DraftState, PickSlot } from './types';

export function isReversedRound(round: number, thirdRoundReversal: boolean): boolean {
  if (round === 1) return false;
  if (!thirdRoundReversal) return round % 2 === 0;
  if (round === 2) return true;
  return round % 2 === 1; // 3RR: round 3 repeats round 2's order, then alternates
}

export function buildSlots(cfg: Pick<DraftConfig, 'type' | 'rounds' | 'teams' | 'thirdRoundReversal'>): PickSlot[] {
  const n = cfg.teams.length;
  const out: PickSlot[] = [];
  let overall = 1;
  for (let round = 1; round <= cfg.rounds; round++) {
    const reversed = cfg.type === 'snake' && isReversedRound(round, cfg.thirdRoundReversal);
    for (let i = 0; i < n; i++) {
      const team = cfg.teams[reversed ? n - 1 - i : i];
      out.push({ overall: overall++, round, pickInRound: i + 1, teamId: team.id });
    }
  }
  return out;
}

export function draftedPlayerIds(state: DraftState): Set<string> {
  const ids = new Set(state.picks.map((p) => p.playerId));
  for (const r of state.preRostered) ids.add(r.playerId);
  if (state.auction?.nomination) ids.add(state.auction.nomination.playerId);
  return ids;
}

/** Players on a team's roster, pre-draft roster first, then picks in the order made. */
export function teamPlayerIds(state: DraftState, teamId: string): string[] {
  return [
    ...state.preRostered.filter((r) => r.teamId === teamId).map((r) => r.playerId),
    ...state.picks.filter((p) => p.teamId === teamId).map((p) => p.playerId),
  ];
}

export function filledOveralls(state: DraftState): Set<number> {
  return new Set(state.picks.map((p) => p.overall));
}

export function currentSlot(state: DraftState): PickSlot | null {
  if (state.config.type === 'auction') return null;
  const filled = filledOveralls(state);
  return state.slots.find((s) => !filled.has(s.overall)) ?? null;
}

/** The team expected to act now: picking (snake/linear) or nominating (auction). */
export function onTheClockTeam(state: DraftState): string | null {
  if (state.status === 'completed') return null;
  if (state.config.type === 'auction') {
    const a = state.auction;
    if (!a || a.phase !== 'nominating') return null;
    return state.config.teams[a.nominatorIndex]?.id ?? null;
  }
  return currentSlot(state)?.teamId ?? null;
}

/** Auction roster size: every drafted slot. Pre-rostered players count against it. */
export function teamRosterCount(state: DraftState, teamId: string): number {
  return teamPlayerIds(state, teamId).length;
}

export function auctionOpenSpots(state: DraftState, teamId: string): number {
  return Math.max(0, rosterSize(state.config.rosterSlots) - teamRosterCount(state, teamId));
}

/** Highest legal bid: the team must keep the minimum bid for every other open spot. */
export function maxBid(state: DraftState, teamId: string): number {
  if (!state.auction) return 0;
  const open = auctionOpenSpots(state, teamId);
  if (open <= 0) return 0;
  const budget = state.auction.budgets[teamId] ?? 0;
  return Math.max(0, budget - (open - 1) * state.config.auction.minBid);
}

export function canBidAtAll(state: DraftState, teamId: string): boolean {
  return auctionOpenSpots(state, teamId) > 0 && maxBid(state, teamId) >= Math.max(state.config.auction.minBid, 0);
}

export function picksRemainingFor(state: DraftState, teamId: string): number {
  if (state.config.type === 'auction') return auctionOpenSpots(state, teamId);
  const filled = filledOveralls(state);
  return state.slots.filter((s) => s.teamId === teamId && !filled.has(s.overall)).length;
}

/** When the server must next wake up to advance the draft (timer expiry or an automatic action). */
export function nextWakeAt(state: DraftState): number | null {
  if (state.status !== 'running') return null;
  const times = [state.clock.deadline, state.autoActionAt].filter((t): t is number => t != null);
  return times.length ? Math.min(...times) : null;
}

/** Remaining ms on the clock, relative to `now`. Null when untimed. */
export function clockRemainingMs(state: DraftState, now: number): number | null {
  if (state.status === 'paused') return state.clock.pausedRemainingMs;
  if (state.clock.deadline == null) return null;
  return Math.max(0, state.clock.deadline - now);
}
