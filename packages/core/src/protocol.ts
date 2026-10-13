import type { DraftCommand, DraftConfig, DraftEvent, DraftState, PoolPlayer } from './types';
import type { RealtimeTokenPayload } from './token';

/** Body the web app POSTs to the realtime worker to create (or reset) a draft room. */
export interface DraftInitRequest {
  config: DraftConfig;
  players: PoolPlayer[];
  autopickTeams?: string[];
  /** Replace an existing room's state (used for resets). */
  force?: boolean;
}

/** Body the realtime worker POSTs back to the web app to persist progress. */
export interface DraftSyncPayload {
  draftId: string;
  status: DraftState['status'];
  startedAt: number | null;
  completedAt: number | null;
  picks: DraftState['picks'];
}

export type ClientMessage = { type: 'ping' } | { type: 'command'; id?: string; command: DraftCommand };

export type ServerMessage =
  | {
      type: 'init';
      serverNow: number;
      you: Pick<RealtimeTokenPayload, 'userId' | 'name' | 'role' | 'teamIds'>;
      state: DraftState | null;
      players: PoolPlayer[];
    }
  | { type: 'state'; serverNow: number; state: DraftState; events: DraftEvent[] }
  | { type: 'presence'; online: { userId: string | null; name: string; role: string }[] }
  | { type: 'error'; id?: string; message: string }
  | { type: 'pong'; serverNow: number };
