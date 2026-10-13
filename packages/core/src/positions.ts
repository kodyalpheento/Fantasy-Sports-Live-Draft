/** NFL player positions as they appear in the player pool. IDP players carry both a specific
 * position (DE, DT, CB, S) and a group position (DL, DB) in `positions`. */
export const NFL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S'] as const;
export type Position = (typeof NFL_POSITIONS)[number];

export const OFFENSE_POSITIONS: Position[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
export const IDP_POSITIONS: Position[] = ['DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S'];

/** Roster slot types a commissioner can configure. */
export const SLOT_TYPES = [
  'QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DST',
  'DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S', 'IDP_FLEX',
  'BN',
] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

export type RosterSlots = Partial<Record<SlotType, number>>;

export const SLOT_LABELS: Record<SlotType, string> = {
  QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'FLEX (RB/WR/TE)', SUPERFLEX: 'SUPERFLEX (QB/RB/WR/TE)',
  K: 'K', DST: 'D/ST', DL: 'DL', LB: 'LB', DB: 'DB', DE: 'DE', DT: 'DT', CB: 'CB', S: 'S',
  IDP_FLEX: 'IDP FLEX', BN: 'Bench',
};

export const SLOT_SHORT: Record<SlotType, string> = {
  QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'FLX', SUPERFLEX: 'SF', K: 'K', DST: 'DEF',
  DL: 'DL', LB: 'LB', DB: 'DB', DE: 'DE', DT: 'DT', CB: 'CB', S: 'S', IDP_FLEX: 'IDP', BN: 'BN',
};

export const FLEX_SLOTS: SlotType[] = ['FLEX', 'SUPERFLEX', 'IDP_FLEX'];

export const SLOT_ELIGIBILITY: Record<SlotType, Position[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  FLEX: ['RB', 'WR', 'TE'],
  SUPERFLEX: ['QB', 'RB', 'WR', 'TE'],
  K: ['K'],
  DST: ['DST'],
  DL: ['DL', 'DE', 'DT'],
  LB: ['LB'],
  DB: ['DB', 'CB', 'S'],
  DE: ['DE'],
  DT: ['DT'],
  CB: ['CB'],
  S: ['S'],
  IDP_FLEX: ['DL', 'DE', 'DT', 'LB', 'DB', 'CB', 'S'],
  BN: [...NFL_POSITIONS],
};

/** Order used when assigning drafted players to slots: most specific first, bench last. */
export const SLOT_FILL_ORDER: SlotType[] = [
  'QB', 'RB', 'WR', 'TE', 'K', 'DST', 'DE', 'DT', 'CB', 'S', 'DL', 'LB', 'DB',
  'FLEX', 'IDP_FLEX', 'SUPERFLEX', 'BN',
];

export const DEFAULT_POSITION_COLORS: Record<Position, string> = {
  QB: '#ef4f7a',
  RB: '#22c7a9',
  WR: '#4fb7f0',
  TE: '#f5a54a',
  K: '#b07cf5',
  DST: '#a7785c',
  DL: '#f08d6a',
  DE: '#f08d6a',
  DT: '#e2725b',
  LB: '#8fbf5a',
  DB: '#d6b54a',
  CB: '#d6b54a',
  S: '#c9a03c',
};

/** Maps raw positions from data providers (Sleeper, ESPN, CSV) onto our positions.
 * Returns the primary position plus any group positions the player is also eligible for. */
export function normalizePosition(raw: string | null | undefined): { position: Position; positions: Position[] } | null {
  if (!raw) return null;
  const p = raw.trim().toUpperCase().replace(/[^A-Z/]/g, '');
  switch (p) {
    case 'QB': case 'RB': case 'WR': case 'TE': case 'K': case 'LB':
      return { position: p, positions: [p] };
    case 'PK':
      return { position: 'K', positions: ['K'] };
    case 'DEF': case 'DST': case 'D/ST': case 'D': case 'DEFENSE':
      return { position: 'DST', positions: ['DST'] };
    case 'DE': case 'EDGE':
      return { position: 'DE', positions: ['DE', 'DL'] };
    case 'DT': case 'NT':
      return { position: 'DT', positions: ['DT', 'DL'] };
    case 'DL':
      return { position: 'DL', positions: ['DL'] };
    case 'OLB': case 'ILB': case 'MLB':
      return { position: 'LB', positions: ['LB'] };
    case 'CB':
      return { position: 'CB', positions: ['CB', 'DB'] };
    case 'S': case 'SS': case 'FS':
      return { position: 'S', positions: ['S', 'DB'] };
    case 'DB':
      return { position: 'DB', positions: ['DB'] };
    default:
      return null;
  }
}

export function isEligible(positions: readonly Position[], slot: SlotType): boolean {
  if (slot === 'BN') return true;
  const allowed = SLOT_ELIGIBILITY[slot];
  return positions.some((p) => allowed.includes(p));
}

/** Total number of drafted roster spots (starters + bench). */
export function rosterSize(slots: RosterSlots): number {
  return SLOT_TYPES.reduce((sum, s) => sum + (slots[s] ?? 0), 0);
}

/** All player positions that can fill at least one non-bench slot in this league. */
export function eligiblePositions(slots: RosterSlots): Set<Position> {
  const out = new Set<Position>();
  for (const s of SLOT_TYPES) {
    if (s === 'BN' || !(slots[s] ?? 0)) continue;
    for (const p of SLOT_ELIGIBILITY[s]) out.add(p);
  }
  return out;
}

export function usesIdp(slots: RosterSlots): boolean {
  return (['DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S', 'IDP_FLEX'] as SlotType[]).some((s) => (slots[s] ?? 0) > 0);
}
