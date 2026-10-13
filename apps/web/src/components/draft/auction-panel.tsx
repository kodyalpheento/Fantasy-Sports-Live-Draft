'use client';

import { canBidAtAll, maxBid, type DraftCommand, type DraftState, type PoolPlayer } from '@fsd/core';
import { useEffect, useState } from 'react';
import { Headshot, PositionPill, formatClock } from './shared';

export function AuctionPanel({
  state, playerMap, colors, myTeamIds, isCommissioner, canDraft, remaining, send,
}: {
  state: DraftState;
  playerMap: Map<string, PoolPlayer>;
  colors: Record<string, string>;
  myTeamIds: string[];
  isCommissioner: boolean;
  canDraft: boolean;
  remaining: number | null;
  send: (c: DraftCommand) => void;
}) {
  const a = state.auction!;
  const nom = a.nomination;
  const teams = state.config.teams;
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? 'Team';
  const biddable = isCommissioner ? teams.map((t) => t.id) : canDraft ? myTeamIds : [];
  const [bidTeam, setBidTeam] = useState<string>(biddable[0] ?? '');
  const [custom, setCustom] = useState('');
  useEffect(() => {
    if (!biddable.includes(bidTeam)) setBidTeam(biddable.find((t) => t !== nom?.highBidder) ?? biddable[0] ?? '');
  }, [biddable, bidTeam, nom?.highBidder]);

  const player = nom ? playerMap.get(nom.playerId) : undefined;
  const nominator = teams[a.nominatorIndex];
  const running = state.status === 'running';
  const limit = bidTeam ? maxBid(state, bidTeam) : 0;
  const bid = (amount: number) => send({ type: 'bid', amount, teamId: bidTeam });

  return (
    <div className="border-b border-white/5 p-3">
      {nom && player ? (
        <div className="rounded-xl bg-gradient-to-br from-ink-800 to-ink-900 p-3">
          <div className="flex items-center gap-3">
            <Headshot player={player} size={56} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-bold text-white">{player.name}</div>
              <div className="flex items-center gap-2 text-xs text-slate-400"><PositionPill position={player.position} colors={colors} /> {player.team ?? 'FA'} · nominated by {teamName(nom.nominatedBy)}</div>
            </div>
            <div className={`font-mono text-2xl font-bold tabular-nums ${remaining != null && remaining < 5000 ? 'text-red-400' : 'text-white'}`}>{formatClock(remaining)}</div>
          </div>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">High bid</div>
              <div className="text-3xl font-extrabold text-brand-400">${nom.highBid}</div>
              <div className="text-sm text-slate-300">{teamName(nom.highBidder)}</div>
            </div>
            <div className="text-right text-xs text-slate-500">{nom.bids.length} bid{nom.bids.length === 1 ? '' : 's'}</div>
          </div>
          {biddable.length > 0 && running && (
            <div className="mt-3 space-y-2">
              {biddable.length > 1 && (
                <select className="input" value={bidTeam} onChange={(e) => setBidTeam(e.target.value)} aria-label="Bid for team">
                  {biddable.map((id) => <option key={id} value={id}>{teamName(id)} (max ${maxBid(state, id)})</option>)}
                </select>
              )}
              {bidTeam === nom.highBidder ? (
                <p className="text-center text-sm text-emerald-300">{teamName(bidTeam)} has the high bid.</p>
              ) : !canBidAtAll(state, bidTeam) ? (
                <p className="text-center text-sm text-slate-400">{teamName(bidTeam)}&apos;s roster is full.</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 5, 10].map((inc) => (
                      <button key={inc} className="btn-primary" disabled={nom.highBid + inc > limit} onClick={() => bid(nom.highBid + inc)}>
                        ${nom.highBid + inc}
                      </button>
                    ))}
                  </div>
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const n = Number(custom); if (n > 0) bid(n); setCustom(''); }}>
                    <input className="input" type="number" min={nom.highBid + 1} max={limit} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={`Custom bid (max $${limit})`} />
                    <button className="btn-secondary">Bid</button>
                  </form>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-ink-800/60 p-3 text-center">
          <div className="text-xs uppercase tracking-wide text-slate-500">{state.status === 'completed' ? 'Auction complete' : 'Up to nominate'}</div>
          {state.status !== 'completed' && nominator && <div className="text-lg font-bold text-white">{nominator.name}</div>}
          {state.status !== 'completed' && <div className="font-mono text-xl text-slate-200">{formatClock(remaining)}</div>}
          {state.status !== 'completed' && (isCommissioner || myTeamIds.includes(nominator?.id ?? '')) && running && (
            <p className="mt-1 text-xs text-slate-400">Pick a player below and press <b>Nominate</b>.</p>
          )}
        </div>
      )}
    </div>
  );
}
