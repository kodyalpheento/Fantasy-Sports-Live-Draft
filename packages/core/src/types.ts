import type { Position, RosterSlots } from './positions';
import type { DraftSettings } from './settings';

export type DraftType = DraftSettings['type'];

/** A player as the draft engine sees it. `rank` is overall rank (lower is better), null if unranked. */
export interface PoolPlayer {
  id: string;
  name: string;
  position: Position;
  positions: Position[];
  team: string | null;
  rank: number | null;
  rookie: boolean;
  headshot?: string | null;
}

export interface DraftTeam {
  id: string;
  name: string;
}

/**
 * A player a team holds before the draft.
 * Snake/linear: with `round`, the keeper uses that team's pick in that round; without, the player is
 * simply already on the roster (dynasty). Auction: `cost` is deducted from the team's budget.
 */
export interface Keeper {
  teamId: string;
  playerId: string;
  round?: number | null;
  cost?: number | null;
}

export interface AuctionConfig {
  budget: number;
  minBid: number;
  nominationSeconds: number;
  bidSeconds: number;
}

export interface DraftConfig {
  draftId: string;
  type: DraftType;
  rounds: number;
  /** Teams in draft order (first pick first). */
  teams: DraftTeam[];
  rosterSlots: RosterSlots;
  pickTimeSeconds: number;
  autopickOnTimeout: boolean;
  thirdRoundReversal: boolean;
  selectionMode: 'commissioner' | 'members';
  auction: AuctionConfig;
  keepers: Keeper[];
  /** Rookie drafts: skip positional caps in autopick, it just takes the best rookie. */
  ignoreRosterCaps?: boolean;
}

export interface PickSlot {
  overall: number;
  round: number;
  pickInRound: number;
  teamId: string;
}

export interface DraftPick extends PickSlot {
  playerId: string;
  /** Winning bid (auction) or keeper cost. */
  price: number | null;
  isKeeper: boolean;
  isAuto: boolean;
  madeBy: string | null;
  /** Auction only: the team that nominated the player. */
  nominatedBy?: string | null;
  at: number;
}

export interface AuctionBid {
  teamId: string;
  amount: number;
  at: number;
}

export interface Nomination {
  playerId: string;
  nominatedBy: string;
  highBid: number;
  highBidder: string;
  bids: AuctionBid[];
}

export interface AuctionState {
  phase: 'nominating' | 'bidding';
  nominatorIndex: number;
  nomination: Nomination | null;
  budgets: Record<string, number>;
}

export interface DraftClock {
  /** Epoch ms when the current pick/nomination/bid window ends. Null when untimed or paused. */
  deadline: number | null;
  /** While paused: the ms left on the clock when it was paused. */
  pausedRemainingMs: number | null;
  durationMs: number;
}

export type DraftStatus = 'pending' | 'running' | 'paused' | 'completed';

export interface DraftState {
  config: DraftConfig;
  status: DraftStatus;
  /** Snake/linear: every pick in order. Empty for auctions. */
  slots: PickSlot[];
  /** Completed selections in the order they happened (keepers first). */
  picks: DraftPick[];
  /** Players already on rosters that do not use a pick (dynasty rosters, keepers without a round/cost). */
  preRostered: { teamId: string; playerId: string }[];
  auction: AuctionState | null;
  clock: DraftClock;
  autopickTeams: string[];
  /** Per-team player queues, used first by autopick. */
  queues: Record<string, string[]>;
  /** Epoch ms when the server should perform the next automatic action (autopick / auto bid). */
  autoActionAt: number | null;
  version: number;
  startedAt: number | null;
  completedAt: number | null;
}

export interface Actor {
  userId: string | null;
  role: 'commissioner' | 'member' | 'viewer' | 'system';
  teamIds: string[];
}

export type DraftCommand =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'undo' }
  | { type: 'pick'; playerId: string; teamId?: string }
  | { type: 'nominate'; playerId: string; amount: number; teamId?: string }
  | { type: 'bid'; amount: number; teamId?: string }
  | { type: 'setAutopick'; teamId: string; enabled: boolean }
  | { type: 'setQueue'; teamId: string; playerIds: string[] };

export type DraftEvent =
  | { kind: 'started' }
  | { kind: 'paused' }
  | { kind: 'resumed' }
  | { kind: 'pick'; pick: DraftPick }
  | { kind: 'undo'; pick: DraftPick }
  | { kind: 'nominated'; playerId: string; teamId: string; amount: number }
  | { kind: 'bid'; teamId: string; amount: number }
  | { kind: 'onTheClock'; teamId: string }
  | { kind: 'completed' };

export interface EngineContext {
  now: number;
  players: Map<string, PoolPlayer>;
}

export interface CommandResult {
  state: DraftState;
  events: DraftEvent[];
  error?: string;
}
