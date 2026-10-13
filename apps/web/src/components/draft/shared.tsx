'use client';

import {
  clockRemainingMs, currentSlot, onTheClockTeam, type DraftEvent, type DraftSettings, type DraftState, type PoolPlayer,
} from '@fsd/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardPick } from './board';
import { audioUnlocked, createAnnouncer, playClip, playSound, speak, unlockAudio } from './audio';

export const POSITION_NAMES: Record<string, string> = {
  QB: 'quarterback', RB: 'running back', WR: 'wide receiver', TE: 'tight end', K: 'kicker', DST: 'defense',
  DL: 'defensive lineman', DE: 'defensive end', DT: 'defensive tackle', LB: 'linebacker', DB: 'defensive back', CB: 'cornerback', S: 'safety',
};

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function formatClock(ms: number | null): string {
  if (ms == null) return '∞';
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export interface TeamMeta {
  announceMediaId: string | null;
  ownerName: string | null;
}

export function toBoardPicks(state: DraftState | null, playerMap: Map<string, PoolPlayer>): BoardPick[] {
  if (!state) return [];
  return state.picks.map((p) => {
    const pl = playerMap.get(p.playerId);
    return {
      overall: p.overall, round: p.round, pickInRound: p.pickInRound, teamId: p.teamId,
      playerName: pl?.name ?? 'Unknown player', position: pl?.position ?? '?', nflTeam: pl?.team ?? null,
      price: p.price, isKeeper: p.isKeeper, isAuto: p.isAuto, headshot: pl?.headshot,
    };
  });
}

export function PositionPill({ position, colors }: { position: string; colors: Record<string, string> }) {
  return (
    <span className="inline-flex min-w-9 justify-center rounded px-1.5 py-0.5 text-[11px] font-bold text-ink-950" style={{ background: colors[position] ?? '#94a3b8' }}>
      {position === 'DST' ? 'DEF' : position}
    </span>
  );
}

export function Headshot({ player, size = 36 }: { player?: Pick<PoolPlayer, 'headshot' | 'name'> | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!player?.headshot || failed) {
    return <div className="grid shrink-0 place-items-center rounded-full bg-ink-700 text-xs font-bold text-slate-300" style={{ width: size, height: size }}>{player?.name?.[0] ?? '?'}</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={player.headshot} alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)}
      className="shrink-0 rounded-full bg-ink-700 object-cover" style={{ width: size, height: size }} />
  );
}

/** Mute preference, stored per device. */
export function useMuted(): [boolean, (v: boolean) => void] {
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    try { setMuted(localStorage.getItem('fsd-muted') === '1'); } catch { /* storage unavailable */ }
  }, []);
  return [muted, (v: boolean) => {
    setMuted(v);
    try { localStorage.setItem('fsd-muted', v ? '1' : '0'); } catch { /* storage unavailable */ }
  }];
}

/** Ask for a click before playing audio (browser autoplay rules). */
export function useAudioGate(): [boolean, () => Promise<void>] {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(audioUnlocked());
    const unlock = () => void unlockAudio().then(setReady);
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  return [ready, async () => setReady(await unlockAudio())];
}

export interface PickFlash {
  key: number;
  player: PoolPlayer | undefined;
  teamName: string;
  overall: number;
  round: number;
  pickInRound: number;
  price: number | null;
}

/**
 * Plays sounds, speech and the on-screen pick announcement for incoming draft events,
 * plus the "time is running out" warning.
 */
export function useDraftAnnouncements(opts: {
  settings: DraftSettings;
  teamMeta: Record<string, TeamMeta>;
  muted: boolean;
}) {
  const { settings, teamMeta, muted } = opts;
  const [flash, setFlash] = useState<PickFlash | null>(null);
  const announce = useMemo(() => createAnnouncer(), []);
  /** Set by the caller once the player pool has loaded. */
  const playersRef = useRef<Map<string, PoolPlayer>>(new Map());
  const ref = useRef({ settings, teamMeta, muted });
  ref.current = { settings, teamMeta, muted };

  const handleEvents = (events: DraftEvent[], state: DraftState) => {
    const { settings: st, teamMeta: meta, muted: m } = ref.current;
    const pm = playersRef.current;
    const a = st.audio;
    const teamName = (id: string) => state.config.teams.find((t) => t.id === id)?.name ?? 'Team';
    for (const ev of events) {
      if (ev.kind === 'pick' && !ev.pick.isKeeper) {
        const player = pm.get(ev.pick.playerId);
        setFlash({ key: Date.now() + ev.pick.overall, player, teamName: teamName(ev.pick.teamId), overall: ev.pick.overall, round: ev.pick.round, pickInRound: ev.pick.pickInRound, price: ev.pick.price });
        if (m) continue;
        playSound(a.pickSound, a.volume);
        if (a.announcePickTts && player) {
          const pos = POSITION_NAMES[player.position] ?? player.position;
          const text = ev.pick.price != null
            ? `${teamName(ev.pick.teamId)} wins ${player.name}, ${pos}, for ${ev.pick.price} dollars.`
            : `With the ${ordinal(ev.pick.overall)} pick, ${teamName(ev.pick.teamId)} selects ${player.name}, ${pos}${player.team && player.position !== 'DST' ? `, ${player.team}` : ''}.`;
          announce(() => new Promise((r) => setTimeout(r, 700)).then(() => speak(text, a.volume)));
        }
      } else if (ev.kind === 'onTheClock' && state.status === 'running' && !m) {
        const id = ev.teamId;
        const text = state.config.type === 'auction' ? `${teamName(id)}, you're up to nominate.` : `${teamName(id)} is on the clock.`;
        if (a.announceMode === 'tts') announce(() => speak(text, a.volume));
        else if (a.announceMode === 'audio') {
          const clip = meta[id]?.announceMediaId;
          announce(() => (clip ? playClip(`/api/media/${clip}`, a.volume) : speak(text, a.volume)));
        }
      } else if (ev.kind === 'nominated' && !m && a.announcePickTts) {
        const player = pm.get(ev.playerId);
        if (player) announce(() => speak(`${teamName(ev.teamId)} nominates ${player.name} for ${ev.amount} dollars.`, a.volume));
      } else if (ev.kind === 'completed' && !m) {
        announce(() => speak('The draft is complete. Good luck this season!', a.volume));
      } else if (ev.kind === 'paused' && !m) {
        announce(() => speak('The draft is paused.', a.volume));
      }
    }
  };

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 6000);
    return () => clearTimeout(t);
  }, [flash]);

  return { flash, setFlash, handleEvents, playersRef };
}

/** Plays the warning sound once per clock when it crosses the threshold. */
export function useClockWarning(state: DraftState | null, now: number, settings: DraftSettings, muted: boolean) {
  const warned = useRef<number | null>(null);
  const remaining = state ? clockRemainingMs(state, now) : null;
  useEffect(() => {
    if (!state || state.status !== 'running' || remaining == null || muted) return;
    const threshold = settings.audio.warningThresholdSeconds * 1000;
    const deadline = state.clock.deadline;
    if (!threshold || deadline == null || threshold >= state.clock.durationMs) return;
    if (remaining > 0 && remaining <= threshold && warned.current !== deadline) {
      warned.current = deadline;
      playSound(settings.audio.warningSound, settings.audio.volume);
    }
  }, [state, remaining, settings, muted]);
  return remaining;
}

export function clockTeamId(state: DraftState | null): string | null {
  if (!state) return null;
  if (state.config.type === 'auction' && state.auction?.phase === 'bidding') return state.auction.nomination?.highBidder ?? null;
  return onTheClockTeam(state);
}

export function currentPickLabel(state: DraftState | null): string {
  if (!state) return '';
  if (state.status === 'completed') return 'Draft complete';
  if (state.config.type === 'auction') {
    return state.auction?.phase === 'bidding' ? 'Bidding' : 'Nominating';
  }
  const slot = currentSlot(state);
  return slot ? `Round ${slot.round} · Pick ${slot.pickInRound} (${ordinal(slot.overall)} overall)` : '';
}

export function PickFlashOverlay({ flash, colors, large = false }: { flash: PickFlash | null; colors: Record<string, string>; large?: boolean }) {
  if (!flash) return null;
  const p = flash.player;
  return (
    <div key={flash.key} className="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex justify-center px-4">
      <div className={`animate-[flashIn_.35s_ease-out] flex items-center gap-4 rounded-2xl border border-white/10 bg-ink-850/95 p-4 pr-8 shadow-2xl backdrop-blur ${large ? 'scale-125' : ''}`}
        style={{ boxShadow: `0 0 0 2px ${colors[p?.position ?? ''] ?? '#10b981'}55, 0 25px 50px -12px rgba(0,0,0,.6)` }}>
        <Headshot player={p} size={large ? 96 : 72} />
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-400">
            {flash.price != null ? `Sold for $${flash.price}` : `Round ${flash.round} · Pick ${flash.pickInRound} · ${ordinal(flash.overall)} overall`}
          </div>
          <div className="text-sm text-slate-300">{flash.teamName} {flash.price != null ? 'wins' : 'selects'}</div>
          <div className="text-2xl font-extrabold text-white">{p?.name ?? 'Unknown player'}</div>
          {p && <div className="mt-1 flex items-center gap-2 text-sm text-slate-300"><PositionPill position={p.position} colors={colors} /> {p.team ?? 'FA'}</div>}
        </div>
      </div>
    </div>
  );
}
