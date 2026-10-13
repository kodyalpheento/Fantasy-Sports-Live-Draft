'use client';

import type { DraftCommand, DraftEvent, DraftState, PoolPlayer, ServerMessage } from '@fsd/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'failed';

export interface RoomIdentity {
  userId: string | null;
  name: string;
  role: 'commissioner' | 'member' | 'viewer';
  teamIds: string[];
}

const BACKOFF = [1000, 2000, 4000, 8000, 15000];

/**
 * Connects to the draft room's Durable Object over WebSocket: fetches a token from the web app, keeps the
 * socket alive with pings, reconnects with backoff, and tracks the server clock offset for accurate timers.
 */
export function useDraftRoom(draftId: string, opts: { viewKey?: string; onEvents?: (events: DraftEvent[], state: DraftState) => void } = {}) {
  const [state, setState] = useState<DraftState | null>(null);
  const [players, setPlayers] = useState<PoolPlayer[]>([]);
  const [you, setYou] = useState<RoomIdentity | null>(null);
  const [online, setOnline] = useState<{ userId: string | null; name: string; role: string }[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const offset = useRef(0);
  const ws = useRef<WebSocket | null>(null);
  const onEvents = useRef(opts.onEvents);
  onEvents.current = opts.onEvents;

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      let token: string;
      let wsUrl: string;
      try {
        const res = await fetch(`/api/drafts/${draftId}/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: opts.viewKey }),
        });
        const body = (await res.json()) as { token?: string; wsUrl?: string; error?: string };
        if (res.status === 401 || res.status === 403 || res.status === 404) {
          setFatal(body.error ?? 'You cannot join this draft.');
          setStatus('failed');
          return;
        }
        if (!res.ok || !body.token || !body.wsUrl) throw new Error(body.error ?? 'Could not open the draft room.');
        token = body.token;
        wsUrl = body.wsUrl;
      } catch (err) {
        setNotice(err instanceof Error ? err.message : 'Connection problem.');
        scheduleRetry();
        return;
      }
      if (closed) return;
      const socket = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`);
      ws.current = socket;
      socket.onopen = () => {
        attempt = 0;
        setStatus('open');
        setNotice(null);
        pingTimer = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send('{"type":"ping"}'), 25_000);
      };
      socket.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as ServerMessage;
        if ('serverNow' in msg && typeof msg.serverNow === 'number') offset.current = msg.serverNow - Date.now();
        switch (msg.type) {
          case 'init':
            setYou(msg.you);
            setPlayers(msg.players);
            setState(msg.state);
            break;
          case 'state':
            setState(msg.state);
            if (msg.events.length) onEvents.current?.(msg.events, msg.state);
            break;
          case 'presence':
            setOnline(msg.online);
            break;
          case 'error':
            setNotice(msg.message);
            break;
        }
      };
      socket.onclose = () => {
        clearInterval(pingTimer);
        if (ws.current === socket) ws.current = null;
        if (!closed) scheduleRetry();
      };
    };

    const scheduleRetry = () => {
      if (closed) return;
      setStatus('reconnecting');
      retryTimer = setTimeout(connect, BACKOFF[Math.min(attempt++, BACKOFF.length - 1)]);
    };

    void connect();
    return () => {
      closed = true;
      clearInterval(pingTimer);
      clearTimeout(retryTimer);
      ws.current?.close();
    };
  }, [draftId, opts.viewKey]);

  const send = useCallback((command: DraftCommand) => {
    const socket = ws.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setNotice('Not connected — reconnecting…');
      return;
    }
    setNotice(null);
    socket.send(JSON.stringify({ type: 'command', command }));
  }, []);

  const playerMap = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const serverNow = useCallback(() => Date.now() + offset.current, []);

  return { state, players, playerMap, you, online, status, fatal, notice, setNotice, send, serverNow };
}

/** Re-render on an interval (for clocks). */
export function useTicker(ms = 250): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}
