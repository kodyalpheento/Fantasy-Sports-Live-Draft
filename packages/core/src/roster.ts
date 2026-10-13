import {
  FLEX_SLOTS, SLOT_ELIGIBILITY, SLOT_FILL_ORDER, SLOT_TYPES, isEligible,
  type Position, type RosterSlots, type SlotType,
} from './positions';
import type { PoolPlayer } from './types';

export interface SlotAssignment {
  playerId: string;
  slot: SlotType | null;
}

export interface SlotFill {
  assignments: SlotAssignment[];
  /** Open spots remaining per slot type. */
  open: Record<SlotType, number>;
}

/** Greedily place players (in the order given) into the most specific open slot they qualify for. */
export function assignSlots(slots: RosterSlots, roster: Pick<PoolPlayer, 'id' | 'positions'>[]): SlotFill {
  const open = Object.fromEntries(SLOT_TYPES.map((s) => [s, slots[s] ?? 0])) as Record<SlotType, number>;
  const assignments: SlotAssignment[] = [];
  for (const p of roster) {
    const slot = SLOT_FILL_ORDER.find((s) => open[s] > 0 && isEligible(p.positions, s)) ?? null;
    if (slot) open[slot]--;
    assignments.push({ playerId: p.id, slot });
  }
  return { assignments, open };
}

export type Fit = 'starter' | 'flex' | 'bench' | 'none';

export interface RosterNeeds {
  open: Record<SlotType, number>;
  unfilledStarters: number;
  fit(player: PoolPlayer): Fit;
  /** False when the team already holds as many players at this position as it could sensibly use. */
  withinCap(player: PoolPlayer): boolean;
}

/** Players beyond starting requirements a team would reasonably roster at each position. */
const CAP_EXTRA: Partial<Record<Position, number>> = {
  QB: 1, TE: 1, K: 0, DST: 0, DL: 1, DE: 1, DT: 1, LB: 1, DB: 1, CB: 1, S: 1,
};

export function analyzeNeeds(slots: RosterSlots, roster: PoolPlayer[]): RosterNeeds {
  const { open } = assignSlots(slots, roster);
  const unfilledStarters = SLOT_TYPES.filter((s) => s !== 'BN').reduce((n, s) => n + open[s], 0);

  const starterSlotsFor = (pos: Position, includeFlex: boolean) =>
    SLOT_TYPES.filter((s) => s !== 'BN' && (includeFlex || !FLEX_SLOTS.includes(s)) && SLOT_ELIGIBILITY[s].includes(pos))
      .reduce((n, s) => n + (slots[s] ?? 0), 0);

  const countAt = (pos: Position) => roster.filter((p) => p.position === pos).length;

  return {
    open,
    unfilledStarters,
    fit(player) {
      for (const s of SLOT_FILL_ORDER) {
        if (s === 'BN' || open[s] <= 0 || !isEligible(player.positions, s)) continue;
        return FLEX_SLOTS.includes(s) ? 'flex' : 'starter';
      }
      return open.BN > 0 ? 'bench' : 'none';
    },
    withinCap(player) {
      const pos = player.position;
      const anyStarter = player.positions.some((p) => starterSlotsFor(p, true) > 0);
      if (!anyStarter) return false; // this league never starts the position
      const extra = CAP_EXTRA[pos];
      if (extra === undefined) return true; // RB / WR: no hard cap
      const dedicated = Math.max(...player.positions.map((p) => starterSlotsFor(p, false)));
      // A superflex spot makes a QB effectively a dedicated starter.
      const sf = pos === 'QB' ? (slots.SUPERFLEX ?? 0) : 0;
      const idpFlex = player.positions.some((p) => SLOT_ELIGIBILITY.IDP_FLEX.includes(p)) ? (slots.IDP_FLEX ?? 0) : 0;
      const cap = Math.max(dedicated + sf + idpFlex, pos === 'K' || pos === 'DST' ? 0 : 1) + extra;
      return countAt(pos) < cap;
    },
  };
}
