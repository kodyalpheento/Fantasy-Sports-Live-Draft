import type { PickSlot } from '@fsd/core';

export interface BoardPick {
  overall: number;
  round: number;
  pickInRound: number;
  teamId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  price: number | null;
  isKeeper: boolean;
  isAuto: boolean;
  headshot?: string | null;
}

export interface BoardProps {
  teams: { id: string; name: string }[];
  type: 'snake' | 'linear' | 'auction';
  rounds: number;
  picks: BoardPick[];
  slots?: PickSlot[];
  colors: Record<string, string>;
  currentOverall?: number | null;
  onClockTeamId?: string | null;
  highlightTeamIds?: string[];
  budgets?: Record<string, number>;
  size?: 'normal' | 'large';
}

function splitName(name: string): [string, string] {
  const i = name.indexOf(' ');
  return i < 0 ? ['', name] : [name.slice(0, i), name.slice(i + 1)];
}

function Cell({ pick, color, large, label, current }: { pick?: BoardPick; color?: string; large: boolean; label: string; current: boolean }) {
  if (!pick) {
    return (
      <div className={`flex items-start justify-end rounded-md border p-1.5 font-mono text-[10px] ${large ? 'h-20' : 'h-[3.75rem]'} ${current ? 'animate-pulse border-brand-400 bg-brand-500/15 text-brand-300' : 'border-white/5 bg-ink-900/60 text-slate-600'}`}>
        {label}
      </div>
    );
  }
  const [first, last] = splitName(pick.playerName);
  const c = color ?? '#64748b';
  return (
    <div className={`relative overflow-hidden rounded-md p-1.5 text-ink-950 shadow-sm ${large ? 'h-20' : 'h-[3.75rem]'}`}
      style={{ background: `linear-gradient(135deg, ${c} 0%, ${c}cc 100%)` }}
      title={`${pick.playerName} · ${pick.position} · ${pick.nflTeam ?? 'FA'}`}>
      {pick.headshot && large && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={pick.headshot} alt="" loading="lazy" className="absolute -bottom-1 right-0 h-16 w-16 object-cover opacity-90" />
      )}
      <div className="relative flex items-start justify-between gap-1">
        <div className="min-w-0">
          <div className={`truncate leading-tight opacity-80 ${large ? 'text-xs' : 'text-[10px]'}`}>{first}</div>
          <div className={`truncate font-bold leading-tight ${large ? 'text-base' : 'text-xs'}`}>{last}</div>
        </div>
        <span className="font-mono text-[9px] opacity-70">{label}</span>
      </div>
      <div className={`relative mt-0.5 flex items-center gap-1 font-semibold ${large ? 'text-xs' : 'text-[10px]'}`}>
        <span>{pick.position === 'DST' ? 'DEF' : pick.position}</span>
        <span className="opacity-70">· {pick.nflTeam ?? 'FA'}</span>
        {pick.price != null && <span className="ml-auto rounded bg-ink-950/20 px-1">${pick.price}</span>}
        {pick.isKeeper && <span className="ml-auto rounded bg-ink-950/25 px-1" title="Keeper">K</span>}
        {pick.isAuto && !pick.isKeeper && pick.price == null && <span className="ml-auto opacity-60" title="Autopick">⚙</span>}
      </div>
    </div>
  );
}

/** The draft board grid: teams across, rounds down. Works on the server (history) and in the live room. */
export function DraftBoard({
  teams, type, rounds, picks, slots, colors, currentOverall, onClockTeamId, highlightTeamIds = [], budgets, size = 'normal',
}: BoardProps) {
  const large = size === 'large';
  const minCol = large ? 150 : 112;
  const auction = type === 'auction';
  const byTeam = new Map(teams.map((t) => [t.id, picks.filter((p) => p.teamId === t.id).sort((a, b) => a.overall - b.overall)]));
  const rowCount = auction ? Math.max(rounds, ...[...byTeam.values()].map((l) => l.length)) : rounds;
  const slotFor = new Map(slots?.map((s) => [`${s.round}:${s.teamId}`, s]) ?? []);

  return (
    <div className="overflow-x-auto">
      <div className="grid gap-1" style={{ gridTemplateColumns: `${large ? 36 : 28}px repeat(${teams.length}, minmax(${minCol}px, 1fr))` }}>
        <div />
        {teams.map((t) => {
          const onClock = t.id === onClockTeamId;
          const mine = highlightTeamIds.includes(t.id);
          return (
            <div key={t.id} className={`truncate rounded-md px-2 py-1.5 text-center font-semibold ${large ? 'text-sm' : 'text-xs'} ${onClock ? 'bg-brand-500 text-ink-950' : mine ? 'bg-sky-500/20 text-sky-200' : 'bg-ink-800 text-slate-200'}`}>
              {t.name}
              {budgets && <div className="font-mono text-[10px] font-normal opacity-80">${budgets[t.id] ?? 0}</div>}
            </div>
          );
        })}
        {Array.from({ length: rowCount }, (_, r) => r + 1).map((round) => (
          <div key={round} className="contents">
            <div className={`flex items-center justify-center font-mono text-slate-500 ${large ? 'text-sm' : 'text-[11px]'}`}>{round}</div>
            {teams.map((t) => {
              if (auction) {
                const pick = byTeam.get(t.id)?.[round - 1];
                return <Cell key={t.id} pick={pick} color={pick ? colors[pick.position] : undefined} large={large} label={pick ? `#${pick.overall}` : ''} current={false} />;
              }
              const pick = byTeam.get(t.id)?.find((p) => p.round === round);
              const slot = slotFor.get(`${round}:${t.id}`);
              const label = slot ? `${round}.${String(slot.pickInRound).padStart(2, '0')}` : pick ? `${round}.${String(pick.pickInRound).padStart(2, '0')}` : '';
              return (
                <Cell key={t.id} pick={pick} color={pick ? colors[pick.position] : undefined} large={large} label={label}
                  current={!pick && slot != null && slot.overall === currentOverall} />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
