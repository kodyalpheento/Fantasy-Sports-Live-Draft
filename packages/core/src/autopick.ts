import { analyzeNeeds, type Fit } from './roster';
import type { DraftState, PoolPlayer } from './types';
import { auctionOpenSpots, draftedPlayerIds, maxBid, picksRemainingFor, teamPlayerIds } from './engine-helpers';

const UNRANKED = 5000;
const CANDIDATE_WINDOW = 40;

const FIT_MULTIPLIER: Record<Fit, number> = { starter: 0.8, flex: 0.9, bench: 1.15, none: 1.3 };
const FIT_VALUE: Record<Fit, number> = { starter: 1, flex: 0.85, bench: 0.5, none: 0.2 };

export function byRank(a: PoolPlayer, b: PoolPlayer): number {
  return (a.rank ?? UNRANKED) - (b.rank ?? UNRANKED) || a.name.localeCompare(b.name);
}

const isKickerOrDefense = (p: PoolPlayer) => p.position === 'K' || p.position === 'DST';

function rosterOf(state: DraftState, teamId: string, players: Map<string, PoolPlayer>): PoolPlayer[] {
  return teamPlayerIds(state, teamId).map((id) => players.get(id)).filter((p): p is PoolPlayer => !!p);
}

/**
 * Choose a player for a team on autopick.
 *
 * 1. The team's queue, in order, if the player is still available and the team can use them.
 * 2. Otherwise the best-ranked available player, weighted by roster need: open starting spots are
 *    preferred over flex, flex over bench, and a team stops taking a position once it has enough
 *    (e.g. after two RBs fill the RB slots it leans to WR/TE/QB). Kickers and defenses wait for the
 *    final rounds, and once the remaining picks only just cover the empty starting spots, it must fill them.
 */
export function chooseAutopick(state: DraftState, teamId: string, players: Map<string, PoolPlayer>): PoolPlayer | null {
  const cfg = state.config;
  const drafted = draftedPlayerIds(state);
  const needs = analyzeNeeds(cfg.rosterSlots, rosterOf(state, teamId, players));
  const ignoreCaps = !!cfg.ignoreRosterCaps;

  for (const id of state.queues[teamId] ?? []) {
    const p = players.get(id);
    if (p && !drafted.has(id) && (ignoreCaps || needs.withinCap(p))) return p;
  }

  const available = [...players.values()].filter((p) => !drafted.has(p.id)).sort(byRank);
  if (available.length === 0) return null;
  if (ignoreCaps) return available[0];

  const remaining = picksRemainingFor(state, teamId);
  const kdOpen = needs.open.K + needs.open.DST;
  const allowKickerDefense = remaining <= kdOpen + 1;
  const forced = remaining <= needs.unfilledStarters;

  let candidates = available.filter((p) => needs.withinCap(p) && (!isKickerOrDefense(p) || allowKickerDefense));
  if (forced) {
    const filling = candidates.filter((p) => {
      const f = needs.fit(p);
      return f === 'starter' || f === 'flex';
    });
    if (filling.length) candidates = filling;
  }
  if (candidates.length === 0) return available[0];

  let best: PoolPlayer | null = null;
  let bestScore = Infinity;
  for (const p of candidates.slice(0, CANDIDATE_WINDOW)) {
    const score = (p.rank ?? UNRANKED) * FIT_MULTIPLIER[needs.fit(p)];
    if (score < bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

/** What an autopick team is willing to pay for a player in an auction. */
export function autoBidValue(state: DraftState, teamId: string, player: PoolPlayer, players: Map<string, PoolPlayer>): number {
  const cfg = state.config;
  const { budget, minBid } = cfg.auction;
  const needs = analyzeNeeds(cfg.rosterSlots, rosterOf(state, teamId, players));
  if (!cfg.ignoreRosterCaps && !needs.withinCap(player)) return 0;
  const fit = needs.fit(player);
  if (fit === 'none') return 0;
  if (player.rank == null || isKickerOrDefense(player)) return minBid;
  const n = Math.max(cfg.teams.length, 1);
  const curve = budget * 0.45 * Math.exp(-(player.rank - 1) / (n * 2.2));
  // Budget pacing: money left over at the end is wasted, so a team with plenty left per open spot bids up.
  const open = Math.max(1, auctionOpenSpots(state, teamId));
  const perSpot = (state.auction?.budgets[teamId] ?? 0) / open;
  const value = Math.round(Math.max(curve, perSpot * 0.9) * FIT_VALUE[fit]);
  return Math.min(Math.max(value, minBid), maxBid(state, teamId));
}
