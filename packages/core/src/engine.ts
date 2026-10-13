import { autoBidValue, chooseAutopick } from './autopick';
import {
  buildSlots, canBidAtAll, currentSlot, draftedPlayerIds, maxBid, teamRosterCount,
} from './engine-helpers';
import type {
  Actor, CommandResult, DraftCommand, DraftConfig, DraftEvent, DraftPick, DraftState, EngineContext,
} from './types';

/** Pause before a team on autopick makes its move, so people can follow along. */
export const AUTO_DELAY_MS = 1500;
const MAX_QUEUE = 150;

export function createDraft(config: DraftConfig): DraftState {
  const state: DraftState = {
    config,
    status: 'pending',
    slots: config.type === 'auction' ? [] : buildSlots(config),
    picks: [],
    preRostered: [],
    auction: null,
    clock: { deadline: null, pausedRemainingMs: null, durationMs: 0 },
    autopickTeams: [],
    queues: {},
    autoActionAt: null,
    version: 0,
    startedAt: null,
    completedAt: null,
  };
  if (config.type === 'auction') {
    state.auction = {
      phase: 'nominating',
      nominatorIndex: 0,
      nomination: null,
      budgets: Object.fromEntries(config.teams.map((t) => [t.id, config.auction.budget])),
    };
  }

  const teamIds = new Set(config.teams.map((t) => t.id));
  const used = new Set<string>();
  for (const k of config.keepers) {
    if (!teamIds.has(k.teamId) || used.has(k.playerId)) continue;
    used.add(k.playerId);
    const base = { playerId: k.playerId, isKeeper: true, isAuto: false, madeBy: null, at: 0 };

    if (config.type === 'auction') {
      if (k.cost != null && state.auction) {
        const cost = Math.max(0, Math.round(k.cost));
        state.auction.budgets[k.teamId] -= cost;
        state.picks.push({
          ...base, overall: state.picks.length + 1, round: teamRosterCount(state, k.teamId) + 1,
          pickInRound: 0, teamId: k.teamId, price: cost,
        });
      } else {
        state.preRostered.push({ teamId: k.teamId, playerId: k.playerId });
      }
      continue;
    }

    if (k.round == null) {
      state.preRostered.push({ teamId: k.teamId, playerId: k.playerId });
      continue;
    }
    const filled = new Set(state.picks.map((p) => p.overall));
    const teamSlots = state.slots.filter((s) => s.teamId === k.teamId && !filled.has(s.overall));
    // Use the requested round; if it is taken, fall back to the team's latest open pick.
    const slot = teamSlots.find((s) => s.round === k.round) ?? teamSlots[teamSlots.length - 1];
    if (slot) state.picks.push({ ...base, ...slot, price: k.cost ?? null });
    else state.preRostered.push({ teamId: k.teamId, playerId: k.playerId });
  }
  return state;
}

function teamIndex(state: DraftState, teamId: string): number {
  return state.config.teams.findIndex((t) => t.id === teamId);
}

function setClock(s: DraftState, seconds: number, now: number) {
  const ms = Math.max(0, seconds) * 1000;
  s.clock.durationMs = ms;
  if (s.status === 'running') {
    s.clock.deadline = ms > 0 ? now + ms : null;
    s.clock.pausedRemainingMs = null;
  } else {
    s.clock.deadline = null;
    s.clock.pausedRemainingMs = ms > 0 ? ms : null;
  }
}

function complete(s: DraftState, now: number, events: DraftEvent[]) {
  s.status = 'completed';
  s.completedAt = now;
  s.clock = { deadline: null, pausedRemainingMs: null, durationMs: 0 };
  s.autoActionAt = null;
  if (s.auction) {
    s.auction.nomination = null;
    s.auction.phase = 'nominating';
  }
  events.push({ kind: 'completed' });
}

function beginPick(s: DraftState, now: number, events: DraftEvent[]) {
  const slot = currentSlot(s);
  if (!slot) return complete(s, now, events);
  setClock(s, s.config.pickTimeSeconds, now);
  events.push({ kind: 'onTheClock', teamId: slot.teamId });
}

function recordPick(
  s: DraftState, playerId: string, meta: { isAuto: boolean; madeBy: string | null }, now: number, events: DraftEvent[],
) {
  const slot = currentSlot(s);
  if (!slot) return;
  const pick: DraftPick = { ...slot, playerId, price: null, isKeeper: false, ...meta, at: now };
  s.picks.push(pick);
  events.push({ kind: 'pick', pick });
  beginPick(s, now, events);
}

function beginNomination(s: DraftState, startIndex: number, now: number, events: DraftEvent[]) {
  const a = s.auction!;
  const n = s.config.teams.length;
  for (let i = 0; i < n; i++) {
    const idx = (startIndex + i) % n;
    const team = s.config.teams[idx];
    if (canBidAtAll(s, team.id)) {
      a.phase = 'nominating';
      a.nomination = null;
      a.nominatorIndex = idx;
      setClock(s, s.config.auction.nominationSeconds, now);
      events.push({ kind: 'onTheClock', teamId: team.id });
      return;
    }
  }
  complete(s, now, events);
}

function startBidding(s: DraftState, playerId: string, teamId: string, amount: number, now: number, events: DraftEvent[]) {
  const a = s.auction!;
  a.phase = 'bidding';
  a.nomination = { playerId, nominatedBy: teamId, highBid: amount, highBidder: teamId, bids: [{ teamId, amount, at: now }] };
  setClock(s, s.config.auction.bidSeconds, now);
  events.push({ kind: 'nominated', playerId, teamId, amount });
}

function placeBid(s: DraftState, teamId: string, amount: number, now: number, events: DraftEvent[]) {
  const nom = s.auction!.nomination!;
  nom.highBid = amount;
  nom.highBidder = teamId;
  nom.bids.push({ teamId, amount, at: now });
  setClock(s, s.config.auction.bidSeconds, now);
  events.push({ kind: 'bid', teamId, amount });
}

function awardNomination(s: DraftState, now: number, events: DraftEvent[]) {
  const a = s.auction!;
  const nom = a.nomination!;
  const pick: DraftPick = {
    overall: s.picks.length + 1,
    round: teamRosterCount(s, nom.highBidder) + 1,
    pickInRound: 0,
    teamId: nom.highBidder,
    playerId: nom.playerId,
    price: nom.highBid,
    isKeeper: false,
    isAuto: s.autopickTeams.includes(nom.highBidder),
    madeBy: null,
    nominatedBy: nom.nominatedBy,
    at: now,
  };
  a.budgets[nom.highBidder] -= nom.highBid;
  a.nomination = null;
  s.picks.push(pick);
  events.push({ kind: 'pick', pick });
  beginNomination(s, a.nominatorIndex + 1, now, events);
}

/** The strongest automatic bid available right now, eBay-style: the top auto bidder bids just enough. */
function computeAutoBid(s: DraftState, ctx: EngineContext): { teamId: string; amount: number } | null {
  const a = s.auction;
  if (!a || a.phase !== 'bidding' || !a.nomination) return null;
  const nom = a.nomination;
  const player = ctx.players.get(nom.playerId);
  if (!player) return null;
  const wants = s.autopickTeams
    .filter((t) => t !== nom.highBidder && canBidAtAll(s, t))
    .map((t) => ({ teamId: t, value: Math.min(autoBidValue(s, t, player, ctx.players), maxBid(s, t)) }))
    .filter((w) => w.value > nom.highBid)
    .sort((x, y) => y.value - x.value);
  if (!wants.length) return null;
  const top = wants[0];
  const runnerUp = wants[1]?.value ?? nom.highBid;
  return { teamId: top.teamId, amount: Math.min(top.value, Math.max(runnerUp, nom.highBid) + 1) };
}

function scheduleAuto(s: DraftState, ctx: EngineContext, previous: number | null) {
  s.autoActionAt = null;
  if (s.status !== 'running') return;
  let want = false;
  if (s.config.type === 'auction') {
    const a = s.auction!;
    if (a.phase === 'nominating') want = s.autopickTeams.includes(s.config.teams[a.nominatorIndex]?.id);
    else want = computeAutoBid(s, ctx) != null;
  } else {
    const slot = currentSlot(s);
    want = !!slot && s.autopickTeams.includes(slot.teamId);
  }
  if (!want) return;
  let at = previous != null && previous > ctx.now ? previous : ctx.now + AUTO_DELAY_MS;
  if (s.clock.deadline != null) at = Math.min(at, Math.max(ctx.now, s.clock.deadline - 250));
  s.autoActionAt = at;
}

function autoNominate(s: DraftState, ctx: EngineContext, events: DraftEvent[]) {
  const a = s.auction!;
  const team = s.config.teams[a.nominatorIndex];
  const player = chooseAutopick(s, team.id, ctx.players);
  if (!player) return complete(s, ctx.now, events);
  // Open near what the team thinks the player is worth, so a team with money to spend actually spends it.
  const minBid = s.config.auction.minBid;
  const value = autoBidValue(s, team.id, player, ctx.players);
  const opening = Math.min(Math.max(Math.round(value * 0.6), minBid, 1), maxBid(s, team.id));
  startBidding(s, player.id, team.id, Math.max(opening, minBid), ctx.now, events);
}

function autoPick(s: DraftState, teamId: string, ctx: EngineContext, events: DraftEvent[]) {
  const player = chooseAutopick(s, teamId, ctx.players);
  if (!player) return complete(s, ctx.now, events);
  recordPick(s, player.id, { isAuto: true, madeBy: null }, ctx.now, events);
}

export function applyCommand(state: DraftState, cmd: DraftCommand, actor: Actor, ctx: EngineContext): CommandResult {
  const fail = (error: string): CommandResult => ({ state, events: [], error });
  const s: DraftState = structuredClone(state);
  const events: DraftEvent[] = [];
  const { now } = ctx;
  const isCommissioner = actor.role === 'commissioner' || actor.role === 'system';
  const canActFor = (teamId: string) =>
    isCommissioner || (actor.role === 'member' && s.config.selectionMode === 'members' && actor.teamIds.includes(teamId));
  const ownsOrCommish = (teamId: string) => isCommissioner || (actor.role === 'member' && actor.teamIds.includes(teamId));
  const previousAuto = s.autoActionAt;

  switch (cmd.type) {
    case 'start': {
      if (!isCommissioner) return fail('Only the commissioner can start the draft.');
      if (s.status !== 'pending') return fail('The draft has already started.');
      s.status = 'running';
      s.startedAt = now;
      events.push({ kind: 'started' });
      if (s.config.type === 'auction') beginNomination(s, 0, now, events);
      else beginPick(s, now, events);
      break;
    }
    case 'pause': {
      if (!isCommissioner) return fail('Only the commissioner can pause the draft.');
      if (s.status !== 'running') return fail('The draft is not running.');
      s.clock.pausedRemainingMs = s.clock.deadline != null ? Math.max(0, s.clock.deadline - now) : null;
      s.clock.deadline = null;
      s.status = 'paused';
      events.push({ kind: 'paused' });
      break;
    }
    case 'resume': {
      if (!isCommissioner) return fail('Only the commissioner can resume the draft.');
      if (s.status !== 'paused') return fail('The draft is not paused.');
      s.status = 'running';
      if (s.clock.pausedRemainingMs != null) s.clock.deadline = now + s.clock.pausedRemainingMs;
      s.clock.pausedRemainingMs = null;
      events.push({ kind: 'resumed' });
      break;
    }
    case 'pick': {
      if (s.config.type === 'auction') return fail('Use nominations and bids in an auction draft.');
      if (s.status !== 'running') return fail(s.status === 'paused' ? 'The draft is paused.' : 'The draft is not running.');
      const slot = currentSlot(s);
      if (!slot) return fail('The draft is complete.');
      const teamId = cmd.teamId ?? slot.teamId;
      if (teamId !== slot.teamId) return fail('That team is not on the clock.');
      if (!canActFor(teamId)) return fail('You cannot pick for this team.');
      if (!ctx.players.has(cmd.playerId)) return fail('Unknown player.');
      if (draftedPlayerIds(s).has(cmd.playerId)) return fail('That player has already been drafted.');
      recordPick(s, cmd.playerId, { isAuto: false, madeBy: actor.userId }, now, events);
      break;
    }
    case 'nominate': {
      const a = s.auction;
      if (!a) return fail('Not an auction draft.');
      if (s.status !== 'running') return fail(s.status === 'paused' ? 'The draft is paused.' : 'The draft is not running.');
      if (a.phase !== 'nominating') return fail('A player is already up for bid.');
      const nominator = s.config.teams[a.nominatorIndex].id;
      const teamId = cmd.teamId ?? nominator;
      if (teamId !== nominator) return fail('It is not that team\'s turn to nominate.');
      if (!canActFor(teamId)) return fail('You cannot nominate for this team.');
      if (!ctx.players.has(cmd.playerId)) return fail('Unknown player.');
      if (draftedPlayerIds(s).has(cmd.playerId)) return fail('That player has already been drafted.');
      const amount = Math.floor(cmd.amount);
      if (!(amount >= s.config.auction.minBid)) return fail(`The opening bid must be at least $${s.config.auction.minBid}.`);
      if (amount > maxBid(s, teamId)) return fail(`Maximum bid for this team is $${maxBid(s, teamId)}.`);
      startBidding(s, cmd.playerId, teamId, amount, now, events);
      break;
    }
    case 'bid': {
      const a = s.auction;
      if (!a) return fail('Not an auction draft.');
      if (s.status !== 'running') return fail(s.status === 'paused' ? 'The draft is paused.' : 'The draft is not running.');
      if (a.phase !== 'bidding' || !a.nomination) return fail('No player is up for bid.');
      const teamId = cmd.teamId ?? actor.teamIds[0];
      if (!teamId || teamIndex(s, teamId) < 0) return fail('Choose a team to bid for.');
      if (!canActFor(teamId)) return fail('You cannot bid for this team.');
      if (teamId === a.nomination.highBidder) return fail('That team already has the high bid.');
      const amount = Math.floor(cmd.amount);
      if (!(amount > a.nomination.highBid)) return fail(`Bid more than $${a.nomination.highBid}.`);
      if (!canBidAtAll(s, teamId)) return fail('That team\'s roster is full.');
      if (amount > maxBid(s, teamId)) return fail(`Maximum bid for this team is $${maxBid(s, teamId)}.`);
      placeBid(s, teamId, amount, now, events);
      break;
    }
    case 'undo': {
      if (!isCommissioner) return fail('Only the commissioner can undo picks.');
      if (s.status === 'pending') return fail('Nothing to undo.');
      let idx = -1;
      for (let i = s.picks.length - 1; i >= 0; i--) if (!s.picks[i].isKeeper) { idx = i; break; }
      if (idx < 0) return fail('Nothing to undo.');
      const [removed] = s.picks.splice(idx, 1);
      if (s.status === 'completed') {
        s.status = 'paused';
        s.completedAt = null;
      }
      events.push({ kind: 'undo', pick: removed });
      if (s.auction) {
        s.auction.budgets[removed.teamId] += removed.price ?? 0;
        // Renumber the auction picks so `overall` stays contiguous.
        s.picks.forEach((p, i) => { p.overall = i + 1; });
        const nominator = removed.nominatedBy ? teamIndex(s, removed.nominatedBy) : -1;
        beginNomination(s, nominator >= 0 ? nominator : s.auction.nominatorIndex, now, events);
      } else {
        beginPick(s, now, events);
      }
      break;
    }
    case 'setAutopick': {
      if (teamIndex(s, cmd.teamId) < 0) return fail('Unknown team.');
      if (!ownsOrCommish(cmd.teamId)) return fail('You cannot change autopick for this team.');
      const set = new Set(s.autopickTeams);
      if (cmd.enabled) set.add(cmd.teamId);
      else set.delete(cmd.teamId);
      s.autopickTeams = s.config.teams.map((t) => t.id).filter((id) => set.has(id));
      break;
    }
    case 'setQueue': {
      if (teamIndex(s, cmd.teamId) < 0) return fail('Unknown team.');
      if (!ownsOrCommish(cmd.teamId)) return fail('You cannot edit this team\'s queue.');
      s.queues[cmd.teamId] = [...new Set(cmd.playerIds)].filter((id) => ctx.players.has(id)).slice(0, MAX_QUEUE);
      break;
    }
    default:
      return fail('Unknown command.');
  }

  scheduleAuto(s, ctx, previousAuto);
  s.version++;
  return { state: s, events };
}

/** Advance the draft for anything time-driven: expired clocks and pending automatic actions. */
export function tick(state: DraftState, ctx: EngineContext): CommandResult {
  if (state.status !== 'running') return { state, events: [] };
  const s: DraftState = structuredClone(state);
  const events: DraftEvent[] = [];
  const { now } = ctx;
  let changed = false;

  if (s.clock.deadline != null && now >= s.clock.deadline) {
    changed = true;
    if (s.config.type === 'auction') {
      const a = s.auction!;
      if (a.phase === 'bidding') awardNomination(s, now, events);
      else if (s.config.autopickOnTimeout || s.autopickTeams.includes(s.config.teams[a.nominatorIndex].id)) autoNominate(s, ctx, events);
      else s.clock.deadline = null; // overtime: wait for the nomination
    } else {
      const slot = currentSlot(s);
      if (slot && (s.config.autopickOnTimeout || s.autopickTeams.includes(slot.teamId))) autoPick(s, slot.teamId, ctx, events);
      else s.clock.deadline = null; // overtime: wait for the pick
    }
  } else if (s.autoActionAt != null && now >= s.autoActionAt) {
    changed = true;
    s.autoActionAt = null;
    if (s.config.type === 'auction') {
      const a = s.auction!;
      if (a.phase === 'nominating') {
        if (s.autopickTeams.includes(s.config.teams[a.nominatorIndex].id)) autoNominate(s, ctx, events);
      } else {
        const bid = computeAutoBid(s, ctx);
        if (bid) placeBid(s, bid.teamId, bid.amount, now, events);
      }
    } else {
      const slot = currentSlot(s);
      if (slot && s.autopickTeams.includes(slot.teamId)) autoPick(s, slot.teamId, ctx, events);
    }
  }

  if (!changed) return { state, events: [] };
  scheduleAuto(s, ctx, null);
  s.version++;
  return { state: s, events };
}
