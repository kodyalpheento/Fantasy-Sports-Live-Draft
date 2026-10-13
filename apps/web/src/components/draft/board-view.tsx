'use client';

import { currentSlot, teamPlayerIds, type DraftSettings } from '@fsd/core';
import { DraftBoard } from './board';
import {
  Headshot, PickFlashOverlay, PositionPill, clockTeamId, currentPickLabel, formatClock, toBoardPicks, useAudioGate,
  useClockWarning, useDraftAnnouncements, useMuted, type TeamMeta,
} from './shared';
import { useDraftRoom, useTicker } from './use-draft-room';

/** Full-screen, read-only board for a TV or projector. */
export function BoardView({ draftId, viewKey, leagueName, title, settings, teamMeta }: {
  draftId: string; viewKey?: string; leagueName: string; title: string; settings: DraftSettings; teamMeta: Record<string, TeamMeta>;
}) {
  const [muted, setMuted] = useMuted();
  const [audioReady, enableAudio] = useAudioGate();
  const announcements = useDraftAnnouncements({ settings, teamMeta, muted });
  const room = useDraftRoom(draftId, { viewKey, onEvents: announcements.handleEvents });
  announcements.playersRef.current = room.playerMap;
  const now = useTicker(250) + (room.serverNow() - Date.now());
  const { state, playerMap } = room;
  const remaining = useClockWarning(state, now, settings, muted);
  const colors = settings.positionColors;

  if (room.fatal) return <div className="grid min-h-screen place-items-center text-slate-300">{room.fatal}</div>;

  const teams = state?.config.teams ?? [];
  const onClock = clockTeamId(state);
  const last = state ? [...state.picks].filter((p) => !p.isKeeper).sort((a, b) => b.at - a.at).slice(0, 6) : [];
  const nom = state?.auction?.nomination;
  const nomPlayer = nom ? playerMap.get(nom.playerId) : undefined;
  const lowTime = remaining != null && state?.status === 'running' && remaining <= settings.audio.warningThresholdSeconds * 1000;

  return (
    <div className="flex min-h-screen flex-col gap-3 p-4">
      <PickFlashOverlay flash={announcements.flash} colors={colors} large />
      <header className="flex flex-wrap items-center gap-6 rounded-2xl bg-ink-900/80 px-5 py-3">
        <div>
          <div className="text-xl font-bold text-white">{leagueName}</div>
          <div className="text-sm text-slate-400">{title} · {currentPickLabel(state)}</div>
        </div>
        {state && state.status !== 'completed' && (
          <div className="mx-auto flex items-center gap-6">
            {nom && nomPlayer ? (
              <div className="flex items-center gap-3">
                <Headshot player={nomPlayer} size={56} />
                <div>
                  <div className="text-2xl font-extrabold text-white">{nomPlayer.name}</div>
                  <div className="text-lg text-slate-300">${nom.highBid} · {teams.find((t) => t.id === nom.highBidder)?.name}</div>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">{state.status === 'pending' ? 'Starting soon' : state.status === 'paused' ? 'Paused' : 'On the clock'}</div>
                <div className="text-3xl font-extrabold text-brand-400">{teams.find((t) => t.id === onClock)?.name ?? '—'}</div>
              </div>
            )}
            <div className={`rounded-2xl px-5 py-2 font-mono text-5xl font-bold tabular-nums ${lowTime ? 'animate-pulse bg-red-500/20 text-red-300' : 'bg-ink-800 text-white'}`}>{formatClock(remaining)}</div>
          </div>
        )}
        {state?.status === 'completed' && <div className="mx-auto text-3xl font-extrabold text-brand-400">🏆 Draft complete</div>}
        <div className="flex items-center gap-2">
          {!audioReady && !muted && <button className="btn-secondary btn-sm" onClick={enableAudio}>🔊 Enable sound</button>}
          <button className="btn-ghost btn-sm" onClick={() => setMuted(!muted)}>{muted ? '🔇' : '🔊'}</button>
          <button className="btn-ghost btn-sm" onClick={() => document.documentElement.requestFullscreen?.()}>⛶</button>
        </div>
      </header>
      <main className="flex-1 overflow-auto">
        {state ? (
          <DraftBoard
            teams={teams} type={state.config.type} size="large"
            rounds={state.config.type === 'auction' ? Math.max(1, ...teams.map((t) => teamPlayerIds(state, t.id).length)) : state.config.rounds}
            slots={state.slots} picks={toBoardPicks(state, playerMap)} colors={colors}
            currentOverall={currentSlot(state)?.overall ?? null} onClockTeamId={onClock} budgets={state.auction?.budgets}
          />
        ) : <div className="grid h-full place-items-center text-slate-400">Connecting…</div>}
      </main>
      {last.length > 0 && (
        <footer className="flex gap-3 overflow-hidden rounded-2xl bg-ink-900/80 px-4 py-2">
          <span className="self-center text-xs font-semibold uppercase tracking-widest text-slate-500">Latest</span>
          {last.map((p) => {
            const pl = playerMap.get(p.playerId);
            return (
              <div key={p.overall} className="flex shrink-0 items-center gap-2 rounded-lg bg-ink-800/70 px-2 py-1">
                <Headshot player={pl} size={28} />
                <div className="text-sm">
                  <div className="font-semibold text-white">{pl?.name}</div>
                  <div className="flex items-center gap-1 text-xs text-slate-400">{pl && <PositionPill position={pl.position} colors={colors} />} {teams.find((t) => t.id === p.teamId)?.name}{p.price != null && ` · $${p.price}`}</div>
                </div>
              </div>
            );
          })}
        </footer>
      )}
    </div>
  );
}
