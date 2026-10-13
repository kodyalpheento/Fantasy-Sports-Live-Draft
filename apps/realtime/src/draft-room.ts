import { DurableObject } from 'cloudflare:workers';
import {
  applyCommand, createDraft, nextWakeAt, tick,
  type Actor, type ClientMessage, type CommandResult, type DraftEvent, type DraftInitRequest, type DraftState,
  type DraftSyncPayload, type PoolPlayer, type RealtimeTokenPayload, type ServerMessage,
} from '@fsd/core';
import { callApp, type Env } from './env';

const PLAYER_CHUNK = 400;
/** Events that change what the web app stores, so they are synced back. */
const PERSISTED_EVENTS = new Set<DraftEvent['kind']>(['started', 'paused', 'resumed', 'pick', 'undo', 'completed']);

/**
 * One Durable Object per draft. It is the single source of truth while a draft is live: it validates every
 * command with the shared engine, runs the pick clock with alarms, performs autopicks and auto-bids, broadcasts
 * state to every connected browser (hibernating WebSockets), and syncs picks back to the web app's database.
 */
export class DraftRoom extends DurableObject<Env> {
  private state: DraftState | null = null;
  private players: PoolPlayer[] = [];
  private playerMap = new Map<string, PoolPlayer>();
  private draftId: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<DraftState>('state')) ?? null;
      this.draftId = (await ctx.storage.get<string>('draftId')) ?? null;
      const chunks = (await ctx.storage.get<number>('players:chunks')) ?? 0;
      if (chunks) {
        const keys = Array.from({ length: chunks }, (_, i) => `players:${i}`);
        const stored = await ctx.storage.get<PoolPlayer[]>(keys);
        this.setPlayers(keys.flatMap((k) => stored.get(k) ?? []));
      }
    });
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
  }

  private setPlayers(players: PoolPlayer[]) {
    this.players = players;
    this.playerMap = new Map(players.map((p) => [p.id, p]));
  }

  async fetch(req: Request): Promise<Response> {
    const action = new URL(req.url).pathname.slice(1);
    const draftId = req.headers.get('x-draft-id');
    if (draftId && this.draftId !== draftId) {
      this.draftId = draftId;
      await this.ctx.storage.put('draftId', draftId);
    }
    switch (action) {
      case 'ws': return this.acceptSocket(req);
      case 'init': return this.init(await req.json<DraftInitRequest>());
      case 'state': return Response.json({ state: this.state, playerCount: this.players.length });
      default: return new Response('Not found', { status: 404 });
    }
  }

  private async init(body: DraftInitRequest): Promise<Response> {
    if (this.state && !body.force) return Response.json({ ok: true, initialized: false, status: this.state.status });
    const players = body.players ?? [];
    let state = createDraft(body.config);
    state.autopickTeams = (body.autopickTeams ?? []).filter((id) => body.config.teams.some((t) => t.id === id));

    const chunks = Math.ceil(players.length / PLAYER_CHUNK);
    const oldChunks = (await this.ctx.storage.get<number>('players:chunks')) ?? 0;
    for (let i = chunks; i < oldChunks; i++) await this.ctx.storage.delete(`players:${i}`);
    for (let i = 0; i < chunks; i++) await this.ctx.storage.put(`players:${i}`, players.slice(i * PLAYER_CHUNK, (i + 1) * PLAYER_CHUNK));
    await this.ctx.storage.put('players:chunks', chunks);
    this.setPlayers(players);

    state = { ...state, version: (this.state?.version ?? 0) + 1 };
    this.state = state;
    await this.ctx.storage.put('state', state);
    await this.ctx.storage.deleteAlarm();
    for (const ws of this.ctx.getWebSockets()) this.sendInit(ws);
    return Response.json({ ok: true, initialized: true, status: state.status });
  }

  private acceptSocket(req: Request): Response {
    const actor = JSON.parse(req.headers.get('x-actor') ?? 'null') as RealtimeTokenPayload | null;
    if (!actor) return new Response('Unauthorized', { status: 401 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [actor.role]);
    server.serializeAttachment(actor);
    this.sendInit(server);
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  private actorOf(ws: WebSocket): RealtimeTokenPayload {
    return ws.deserializeAttachment() as RealtimeTokenPayload;
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Socket already closed; the close handler cleans up.
    }
  }

  /** Each connection only sees its own teams' queues. */
  private viewFor(actor: RealtimeTokenPayload, state: DraftState): DraftState {
    if (actor.role === 'commissioner') return state;
    const queues = Object.fromEntries(Object.entries(state.queues).filter(([teamId]) => actor.teamIds.includes(teamId)));
    return { ...state, queues };
  }

  private sendInit(ws: WebSocket) {
    const actor = this.actorOf(ws);
    this.send(ws, {
      type: 'init',
      serverNow: Date.now(),
      you: { userId: actor.userId, name: actor.name, role: actor.role, teamIds: actor.teamIds },
      state: this.state ? this.viewFor(actor, this.state) : null,
      players: this.players,
    });
  }

  private broadcastPresence() {
    const online = this.ctx.getWebSockets().map((ws) => {
      const a = this.actorOf(ws);
      return { userId: a.userId, name: a.name, role: a.role };
    });
    for (const ws of this.ctx.getWebSockets()) this.send(ws, { type: 'presence', online });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 16_384) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return this.send(ws, { type: 'error', message: 'Malformed message.' });
    }
    if (msg.type === 'ping') return this.send(ws, { type: 'pong', serverNow: Date.now() });
    if (msg.type !== 'command' || !msg.command) return;

    const actor = this.actorOf(ws);
    if (actor.role === 'viewer') return this.send(ws, { type: 'error', id: msg.id, message: 'This is a view-only connection.' });
    if (!this.state) return this.send(ws, { type: 'error', id: msg.id, message: 'The draft room is not ready yet.' });

    const engineActor: Actor = { userId: actor.userId, role: actor.role, teamIds: actor.teamIds };
    const result = applyCommand(this.state, msg.command, engineActor, { now: Date.now(), players: this.playerMap });
    if (result.error) return this.send(ws, { type: 'error', id: msg.id, message: result.error });
    await this.commit(result);
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, 'closing');
    } catch {
      // already closed
    }
    this.broadcastPresence();
  }

  async webSocketError(): Promise<void> {
    this.broadcastPresence();
  }

  async alarm(): Promise<void> {
    if (!this.state) return;
    const result = tick(this.state, { now: Date.now(), players: this.playerMap });
    if (result.state !== this.state) await this.commit(result);
    else await this.scheduleAlarm();
  }

  private async scheduleAlarm() {
    const at = this.state ? nextWakeAt(this.state) : null;
    if (at == null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(at, Date.now()));
  }

  private async commit(result: CommandResult) {
    this.state = result.state;
    await this.ctx.storage.put('state', result.state);
    await this.scheduleAlarm();
    const serverNow = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { type: 'state', serverNow, state: this.viewFor(this.actorOf(ws), result.state), events: result.events });
    }
    if (result.events.some((e) => PERSISTED_EVENTS.has(e.kind))) this.ctx.waitUntil(this.persist());
  }

  /** Push the full pick list to the web app. Idempotent, so a failed sync is repaired by the next one. */
  private async persist() {
    if (!this.state || !this.draftId) return;
    const s = this.state;
    const payload: DraftSyncPayload = {
      draftId: this.draftId, status: s.status, startedAt: s.startedAt, completedAt: s.completedAt, picks: s.picks,
    };
    try {
      const res = await callApp(this.env, `/api/internal/drafts/${this.draftId}/sync`, { method: 'POST', body: JSON.stringify(payload) });
      if (!res.ok) console.error('draft sync failed', res.status, await res.text());
    } catch (err) {
      console.error('draft sync failed', err);
    }
  }
}
