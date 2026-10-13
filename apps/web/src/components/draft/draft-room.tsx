'use client';

import {
  SLOT_SHORT, assignSlots, byRank, currentSlot, draftedPlayerIds, maxBid, onTheClockTeam, teamPlayerIds,
  type DraftSettings, type PoolPlayer, type SlotType,
} from '@fsd/core';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AuctionPanel } from './auction-panel';
import { DraftBoard } from './board';
import {
  Headshot, PickFlashOverlay, PositionPill, clockTeamId, currentPickLabel, formatClock, toBoardPicks, useAudioGate,
  useClockWarning, useDraftAnnouncements, useMuted, type TeamMeta,
} from './shared';
import { useDraftRoom, useTicker } from './use-draft-room';

interface Props {
  draftId: string;
  leagueId: string;
  leagueName: string;
  title: string;
  isMock: boolean;
  settings: DraftSettings;
  teamMeta: Record<string, TeamMeta>;
}

type Tab = 'players' | 'queue' | 'roster' | 'teams';
const PAGE = 150;

export function DraftRoom({ draftId, leagueId, leagueName, title, isMock, settings, teamMeta }: Props) {
  const [muted, setMuted] = useMuted();
  const [audioReady, enableAudio] = useAudioGate();
  const colors = settings.positionColors;
  const announcements = useDraftAnnouncements({ settings, teamMeta, muted });
  const room = useDraftRoom(draftId, { onEvents: announcements.handleEvents });
  announcements.playersRef.current = room.playerMap;

  const now = useTicker(250) + (room.serverNow() - Date.now());
  const { state, playerMap, you, send } = room;
  const remaining = useClockWarning(state, now, settings, muted);

  const [tab, setTab] = useState<Tab>('players');
  const [mobileView, setMobileView] = useState<'board' | 'panel'>('board');
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<string>('ALL');
  const [limit, setLimit] = useState(PAGE);
  const [rosterTeam, setRosterTeam] = useState<string | null>(null);
  const [nominateAmount, setNominateAmount] = useState<number | null>(null);

  const isCommissioner = you?.role === 'commissioner';
  const myTeamIds = you?.teamIds ?? [];
  const myTeam = myTeamIds[0] ?? null;
  const teams = state?.config.teams ?? [];
  const teamName = (id: string | null | undefined) => teams.find((t) => t.id === id)?.name ?? '—';
  const auction = state?.config.type === 'auction';
  const running = state?.status === 'running';
  const onClock = state ? onTheClockTeam(state) : null;
  const membersPick = state?.config.selectionMode === 'members';
  const canActFor = (teamId: string | null) => !!teamId && (isCommissioner || (membersPick && myTeamIds.includes(teamId)));
  const canPickNow = !!state && !auction && running && canActFor(onClock);
  const canNominateNow = !!state && auction && running && state.auction?.phase === 'nominating' && canActFor(onClock);

  const drafted = useMemo(() => (state ? draftedPlayerIds(state) : new Set<string>()), [state]);
  const available = useMemo(() => room.players.filter((p) => !drafted.has(p.id)).sort(byRank), [room.players, drafted]);
  const positions = useMemo(() => {
    const order = ['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S'];
    const present = new Set(room.players.map((p) => p.position));
    return order.filter((p) => present.has(p as PoolPlayer['position']));
  }, [room.players]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return available.filter((p) =>
      (pos === 'ALL' || (pos === 'FLEX' ? ['RB', 'WR', 'TE'].includes(p.position) : pos === 'ROOKIE' ? p.rookie : p.positions.includes(pos as PoolPlayer['position']))) &&
      (!q || p.name.toLowerCase().includes(q) || (p.team ?? '').toLowerCase() === q));
  }, [available, pos, search]);

  const queue = myTeam && state ? state.queues[myTeam] ?? [] : [];
  const setQueue = (ids: string[]) => myTeam && send({ type: 'setQueue', teamId: myTeam, playerIds: ids });
  const toggleQueue = (id: string) => setQueue(queue.includes(id) ? queue.filter((q) => q !== id) : [...queue, id]);

  const draftPlayer = (p: PoolPlayer) => {
    if (!state || !onClock) return;
    if (auction) {
      const amount = nominateAmount ?? Math.max(state.config.auction.minBid, 1);
      send({ type: 'nominate', playerId: p.id, amount, teamId: onClock });
      setNominateAmount(null);
    } else {
      send({ type: 'pick', playerId: p.id, teamId: onClock });
    }
  };

  if (room.fatal) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="text-xl font-bold text-white">Can&apos;t join this draft</h1>
        <p className="mt-2 text-slate-400">{room.fatal}</p>
        <Link href={`/leagues/${leagueId}`} className="btn-secondary mt-6">Back to league</Link>
      </div>
    );
  }

  const boardPicks = toBoardPicks(state, playerMap);
  const slot = state ? currentSlot(state) : null;
  const viewRosterTeam = rosterTeam ?? myTeam ?? teams[0]?.id ?? null;
  const highlight = clockTeamId(state);
  const lowTime = remaining != null && running && remaining <= settings.audio.warningThresholdSeconds * 1000;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col">
      <PickFlashOverlay flash={announcements.flash} colors={colors} />

      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-white/5 bg-ink-900/80 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link href={`/leagues/${leagueId}`} className="truncate text-sm font-semibold text-white hover:underline">{leagueName}</Link>
            {isMock && <span className="badge bg-violet-500/20 text-violet-200">Mock</span>}
            <span className={`h-2 w-2 rounded-full ${room.status === 'open' ? 'bg-emerald-400' : 'animate-pulse bg-amber-400'}`} title={room.status} />
            <span className="text-xs text-slate-500">{room.online.length} online</span>
          </div>
          <div className="text-xs text-slate-400">{title} · {currentPickLabel(state)}</div>
        </div>

        <div className="mx-auto flex items-center gap-4">
          {state && state.status !== 'completed' && (
            <>
              <div className="text-right">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                  {state.status === 'pending' ? 'Waiting to start' : state.status === 'paused' ? 'Paused' : auction ? (state.auction?.phase === 'bidding' ? 'High bidder' : 'Nominating') : 'On the clock'}
                </div>
                <div className={`max-w-[40vw] truncate text-lg font-bold ${myTeamIds.includes(highlight ?? '') ? 'text-sky-300' : 'text-white'}`}>{teamName(highlight ?? onClock)}</div>
              </div>
              <div className={`rounded-xl px-3 py-1 font-mono text-3xl font-bold tabular-nums ${state.status === 'paused' ? 'bg-amber-500/15 text-amber-300' : lowTime ? 'animate-pulse bg-red-500/20 text-red-300' : 'bg-ink-800 text-white'}`}>
                {formatClock(remaining)}
              </div>
            </>
          )}
          {state?.status === 'completed' && (
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-brand-400">🏆 Draft complete</span>
              {!isMock && <Link className="btn-primary btn-sm" href={`/leagues/${leagueId}/history?draft=${draftId}`}>Results & export</Link>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {isCommissioner && state?.status === 'pending' && <button className="btn-primary" onClick={() => send({ type: 'start' })}>▶ Start draft</button>}
          {isCommissioner && state?.status === 'running' && <button className="btn-secondary btn-sm" onClick={() => send({ type: 'pause' })}>⏸ Pause</button>}
          {isCommissioner && state?.status === 'paused' && <button className="btn-primary btn-sm" onClick={() => send({ type: 'resume' })}>▶ Resume</button>}
          {isCommissioner && state && state.status !== 'pending' && (
            <button className="btn-ghost btn-sm" onClick={() => window.confirm('Undo the last pick?') && send({ type: 'undo' })}>↶ Undo</button>
          )}
          {myTeam && state && state.status !== 'completed' && (
            <button className={`btn-sm btn ${state.autopickTeams.includes(myTeam) ? 'bg-amber-500 text-ink-950' : 'btn-secondary'}`}
              onClick={() => send({ type: 'setAutopick', teamId: myTeam, enabled: !state.autopickTeams.includes(myTeam) })}
              title="Let the computer draft for you">
              {state.autopickTeams.includes(myTeam) ? '🤖 Autopick ON' : '🤖 Autopick'}
            </button>
          )}
          <button className="btn-ghost btn-sm" onClick={() => setMuted(!muted)} title={muted ? 'Unmute' : 'Mute all sounds'}>{muted ? '🔇' : '🔊'}</button>
          <Link href={`/board/${draftId}`} target="_blank" className="btn-ghost btn-sm" title="Open the big-screen board">📺 Board</Link>
        </div>
      </div>

      {!audioReady && !muted && (
        <button onClick={enableAudio} className="bg-sky-500/15 py-1.5 text-center text-xs text-sky-200 hover:bg-sky-500/25">
          🔊 Click anywhere to turn on draft sounds and announcements
        </button>
      )}
      {room.notice && (
        <div className="flex items-center justify-center gap-3 bg-amber-500/15 py-1.5 text-sm text-amber-200">
          {room.notice} <button className="text-xs underline" onClick={() => room.setNotice(null)}>dismiss</button>
        </div>
      )}
      {myTeam && canPickNow && onClock && myTeamIds.includes(onClock) && (
        <div className="bg-brand-500 py-1.5 text-center text-sm font-bold text-ink-950">You&apos;re on the clock! Pick a player below.</div>
      )}

      {/* Mobile switcher */}
      <div className="flex border-b border-white/5 lg:hidden">
        {(['board', 'panel'] as const).map((v) => (
          <button key={v} onClick={() => setMobileView(v)} className={`flex-1 py-2 text-sm font-medium ${mobileView === v ? 'border-b-2 border-brand-500 text-white' : 'text-slate-400'}`}>
            {v === 'board' ? 'Board' : 'Players & team'}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_400px]">
        <div className={`min-h-0 overflow-auto p-3 ${mobileView === 'board' ? 'block' : 'hidden'} lg:block`}>
          {!state ? (
            <div className="grid h-full place-items-center text-slate-400">{room.status === 'open' ? 'Setting up the draft room…' : 'Connecting…'}</div>
          ) : (
            <DraftBoard
              teams={teams}
              type={state.config.type}
              rounds={state.config.type === 'auction' ? Math.max(1, ...teams.map((t) => teamPlayerIds(state, t.id).length)) : state.config.rounds}
              slots={state.slots}
              picks={boardPicks}
              colors={colors}
              currentOverall={slot?.overall ?? null}
              onClockTeamId={highlight}
              highlightTeamIds={myTeamIds}
              budgets={state.auction?.budgets}
            />
          )}
        </div>

        <aside className={`flex min-h-0 flex-col border-l border-white/5 bg-ink-900/60 ${mobileView === 'panel' ? 'flex' : 'hidden'} lg:flex`}>
          {state && auction && (
            <AuctionPanel state={state} playerMap={playerMap} colors={colors} myTeamIds={myTeamIds} isCommissioner={isCommissioner}
              canDraft={membersPick} remaining={remaining} send={send} />
          )}
          <div className="flex border-b border-white/5 text-sm">
            {([['players', 'Players'], ['queue', `Queue${queue.length ? ` (${queue.length})` : ''}`], ['roster', 'Rosters'], ['teams', 'Teams']] as [Tab, string][]).map(([t, label]) => (
              <button key={t} onClick={() => setTab(t)} className={`flex-1 py-2 font-medium ${tab === t ? 'border-b-2 border-brand-500 text-white' : 'text-slate-400 hover:text-white'}`}>{label}</button>
            ))}
          </div>

          {tab === 'players' && (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="space-y-2 border-b border-white/5 p-2">
                <input className="input" placeholder="Search players or NFL team (e.g. KC)…" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(PAGE); }} />
                <div className="flex flex-wrap gap-1">
                  {['ALL', ...positions, ...(positions.some((p) => ['RB', 'WR', 'TE'].includes(p)) ? ['FLEX'] : []), 'ROOKIE'].map((p) => (
                    <button key={p} onClick={() => { setPos(p); setLimit(PAGE); }}
                      className={`rounded-md px-2 py-0.5 text-xs font-semibold ${pos === p ? 'text-ink-950' : 'bg-ink-800 text-slate-300'}`}
                      style={pos === p ? { background: colors[p] ?? '#10b981' } : undefined}>
                      {p === 'DST' ? 'DEF' : p}
                    </button>
                  ))}
                </div>
                {canNominateNow && (
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    Opening bid $
                    <input className="input w-20 py-1" type="number" min={state!.config.auction.minBid} max={maxBid(state!, onClock!)}
                      value={nominateAmount ?? Math.max(state!.config.auction.minBid, 1)} onChange={(e) => setNominateAmount(Number(e.target.value))} />
                  </div>
                )}
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto">
                {filtered.slice(0, limit).map((p) => (
                  <li key={p.id} className="flex items-center gap-2 border-b border-white/5 px-2 py-1.5 hover:bg-white/[0.03]">
                    <span className="w-8 text-right font-mono text-[11px] text-slate-500">{p.rank ?? '—'}</span>
                    <Headshot player={p} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-white">{p.name}{p.rookie && <span className="ml-1 text-[10px] text-amber-300">R</span>}</div>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400"><PositionPill position={p.position} colors={colors} /> {p.team ?? 'FA'}</div>
                    </div>
                    {myTeam && (
                      <button onClick={() => toggleQueue(p.id)} className={`px-1 text-lg ${queue.includes(p.id) ? 'text-amber-300' : 'text-slate-600 hover:text-slate-300'}`} title="Queue">★</button>
                    )}
                    {(canPickNow || canNominateNow) && (
                      <button className="btn-primary btn-sm" onClick={() => draftPlayer(p)}>{auction ? 'Nominate' : 'Draft'}</button>
                    )}
                  </li>
                ))}
                {filtered.length > limit && (
                  <li className="p-2"><button className="btn-ghost w-full" onClick={() => setLimit(limit + PAGE)}>Show more ({filtered.length - limit} left)</button></li>
                )}
                {filtered.length === 0 && <li className="p-6 text-center text-sm text-slate-500">No available players match.</li>}
              </ul>
            </div>
          )}

          {tab === 'queue' && (
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {!myTeam ? <p className="p-4 text-sm text-slate-400">You don&apos;t have a team in this league.</p> : queue.length === 0 ? (
                <p className="p-4 text-sm text-slate-400">Star players in the Players tab to line them up. If you&apos;re on autopick or your clock runs out, your queue is drafted first.</p>
              ) : (
                <ol className="space-y-1">
                  {queue.map((id, i) => {
                    const p = playerMap.get(id);
                    const gone = drafted.has(id);
                    return (
                      <li key={id} className={`flex items-center gap-2 rounded-lg bg-ink-800/60 px-2 py-1.5 ${gone ? 'opacity-40 line-through' : ''}`}>
                        <span className="w-5 font-mono text-xs text-slate-500">{i + 1}</span>
                        <Headshot player={p} size={28} />
                        <span className="min-w-0 flex-1 truncate text-sm text-white">{p?.name}</span>
                        {p && <PositionPill position={p.position} colors={colors} />}
                        <button className="px-1 text-slate-400 hover:text-white" disabled={i === 0} onClick={() => { const q = [...queue]; [q[i - 1], q[i]] = [q[i], q[i - 1]]; setQueue(q); }}>▲</button>
                        <button className="px-1 text-slate-400 hover:text-white" disabled={i === queue.length - 1} onClick={() => { const q = [...queue]; [q[i + 1], q[i]] = [q[i], q[i + 1]]; setQueue(q); }}>▼</button>
                        <button className="px-1 text-slate-400 hover:text-red-300" onClick={() => setQueue(queue.filter((x) => x !== id))}>✕</button>
                        {!gone && (canPickNow || canNominateNow) && p && <button className="btn-primary btn-sm" onClick={() => draftPlayer(p)}>{auction ? 'Nom' : 'Draft'}</button>}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}

          {tab === 'roster' && state && viewRosterTeam && (
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <select className="input mb-2" value={viewRosterTeam} onChange={(e) => setRosterTeam(e.target.value)}>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}{myTeamIds.includes(t.id) ? ' (you)' : ''}</option>)}
              </select>
              {auction && state.auction && (
                <p className="mb-2 text-xs text-slate-400">Budget ${state.auction.budgets[viewRosterTeam]} · max bid ${maxBid(state, viewRosterTeam)}</p>
              )}
              <RosterView state={state} teamId={viewRosterTeam} playerMap={playerMap} colors={colors} />
            </div>
          )}

          {tab === 'teams' && state && (
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <ul className="space-y-1">
                {teams.map((t, i) => {
                  const auto = state.autopickTeams.includes(t.id);
                  const canToggle = isCommissioner || myTeamIds.includes(t.id);
                  const owner = teamMeta[t.id]?.ownerName;
                  const isOnline = room.online.some((o) => o.name === owner);
                  return (
                    <li key={t.id} className="flex items-center gap-2 rounded-lg bg-ink-800/60 px-2 py-1.5 text-sm">
                      <span className="w-5 font-mono text-xs text-slate-500">{i + 1}</span>
                      <span className={`h-2 w-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-slate-600'}`} title={isOnline ? 'Online' : 'Offline'} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-white">{t.name}</div>
                        <div className="truncate text-xs text-slate-500">{owner ?? 'No owner'}{state.auction ? ` · $${state.auction.budgets[t.id]}` : ''}</div>
                      </div>
                      <button disabled={!canToggle || state.status === 'completed'} onClick={() => send({ type: 'setAutopick', teamId: t.id, enabled: !auto })}
                        className={`btn-sm btn ${auto ? 'bg-amber-500 text-ink-950' : 'border border-white/10 text-slate-400'}`}>
                        {auto ? 'Auto' : 'Manual'}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {isCommissioner && state.status !== 'completed' && (
                <div className="mt-3 flex gap-2">
                  <button className="btn-secondary btn-sm flex-1" onClick={() => teams.forEach((t) => !myTeamIds.includes(t.id) && send({ type: 'setAutopick', teamId: t.id, enabled: true }))}>Autopick all others</button>
                  <button className="btn-secondary btn-sm flex-1" onClick={() => teams.forEach((t) => send({ type: 'setAutopick', teamId: t.id, enabled: false }))}>Everyone manual</button>
                </div>
              )}
              <h3 className="mt-5 mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">In the room</h3>
              <ul className="text-sm text-slate-300">{room.online.map((o, i) => <li key={i}>{o.name} <span className="text-xs text-slate-500">{o.role}</span></li>)}</ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function RosterView({ state, teamId, playerMap, colors }: { state: NonNullable<ReturnType<typeof useDraftRoom>['state']>; teamId: string; playerMap: Map<string, PoolPlayer>; colors: Record<string, string> }) {
  const roster = teamPlayerIds(state, teamId).map((id) => playerMap.get(id)).filter((p): p is PoolPlayer => !!p);
  const { assignments } = assignSlots(state.config.rosterSlots, roster);
  const slots = state.config.rosterSlots;
  const rows: { slot: SlotType | null; player?: PoolPlayer }[] = [];
  const order: SlotType[] = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DST', 'DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S', 'IDP_FLEX', 'BN'];
  for (const s of order) {
    const filled = assignments.filter((a) => a.slot === s).map((a) => playerMap.get(a.playerId));
    for (let i = 0; i < (slots[s] ?? 0); i++) rows.push({ slot: s, player: filled[i] });
  }
  for (const a of assignments.filter((x) => x.slot === null)) rows.push({ slot: null, player: playerMap.get(a.playerId) });
  return (
    <ul className="space-y-1">
      {rows.map((r, i) => (
        <li key={i} className="flex items-center gap-2 rounded-lg bg-ink-800/50 px-2 py-1.5 text-sm">
          <span className="w-9 text-center text-[11px] font-bold text-slate-400">{r.slot ? SLOT_SHORT[r.slot] : '+'}</span>
          {r.player ? (
            <>
              <Headshot player={r.player} size={26} />
              <span className="min-w-0 flex-1 truncate text-white">{r.player.name}</span>
              <PositionPill position={r.player.position} colors={colors} />
              <span className="w-8 text-right text-xs text-slate-500">{r.player.team ?? 'FA'}</span>
            </>
          ) : <span className="text-slate-600">Empty</span>}
        </li>
      ))}
    </ul>
  );
}
