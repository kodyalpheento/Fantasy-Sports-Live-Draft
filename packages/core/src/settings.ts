import { z } from 'zod';
import { DEFAULT_POSITION_COLORS, SLOT_TYPES, rosterSize, type RosterSlots } from './positions';

export const DRAFT_TYPES = ['snake', 'linear', 'auction'] as const;
export const LEAGUE_STYLES = ['redraft', 'keeper', 'dynasty'] as const;
export const SCORING_TYPES = ['ppr', 'half_ppr', 'standard'] as const;
export const BUILTIN_SOUNDS = ['none', 'chime', 'horn', 'whistle', 'beep', 'buzzer'] as const;

const slotCount = z.number().int().min(0).max(20);
const rosterSlotsSchema = z.object(
  Object.fromEntries(SLOT_TYPES.map((s) => [s, slotCount.optional()])) as Record<(typeof SLOT_TYPES)[number], z.ZodOptional<typeof slotCount>>,
);

export const leagueSettingsSchema = z.object({
  teamCount: z.number().int().min(2).max(32),
  leagueStyle: z.enum(LEAGUE_STYLES),
  /** Keeper leagues: the maximum keepers per team. */
  maxKeepers: z.number().int().min(0).max(40),
  scoring: z.enum(SCORING_TYPES),
  rosterSlots: rosterSlotsSchema,
  /** Injured reserve spots. Not drafted, included for export/reference. */
  irSlots: z.number().int().min(0).max(10),
});
export type LeagueSettings = z.infer<typeof leagueSettingsSchema>;

/** `none` | a built-in sound name | `media:<uuid>` for an uploaded audio file. */
const soundRef = z.string().max(80).regex(/^(none|chime|horn|whistle|beep|buzzer|media:[0-9a-f-]{36})$/);

export const draftSettingsSchema = z.object({
  type: z.enum(DRAFT_TYPES),
  rounds: z.number().int().min(1).max(40),
  /** Dynasty leagues typically run a rookies-only draft. */
  playerPool: z.enum(['all', 'rookies']),
  /** Seconds per pick for snake/linear drafts. 0 = no limit. */
  pickTimeSeconds: z.number().int().min(0).max(86_400),
  autopickOnTimeout: z.boolean(),
  thirdRoundReversal: z.boolean(),
  /** `commissioner`: only the commissioner makes picks/bids. `members`: members draft for their own team. */
  selectionMode: z.enum(['commissioner', 'members']),
  auction: z.object({
    budget: z.number().int().min(1).max(100_000),
    minBid: z.number().int().min(0).max(1000),
    nominationSeconds: z.number().int().min(0).max(3600),
    bidSeconds: z.number().int().min(3).max(600),
  }),
  audio: z.object({
    pickSound: soundRef,
    warningSound: soundRef,
    warningThresholdSeconds: z.number().int().min(0).max(600),
    /** How the team on the clock is announced. */
    announceMode: z.enum(['none', 'tts', 'audio']),
    /** Read the selected player aloud with text-to-speech. */
    announcePickTts: z.boolean(),
    volume: z.number().min(0).max(1),
  }),
  positionColors: z.record(z.string(), z.string().regex(/^#[0-9a-fA-F]{6}$/)),
});
export type DraftSettings = z.infer<typeof draftSettingsSchema>;

export const leagueConfigSchema = z.object({
  league: leagueSettingsSchema,
  draft: draftSettingsSchema,
});
export type LeagueConfig = z.infer<typeof leagueConfigSchema>;

export interface RosterPreset {
  id: string;
  label: string;
  description: string;
  slots: RosterSlots;
}

/** Common starting points, modeled on the default formats of the big platforms. Every slot remains editable. */
export const ROSTER_PRESETS: RosterPreset[] = [
  {
    id: 'espn-standard',
    label: 'ESPN Standard',
    description: 'QB, 2 RB, 2 WR, TE, FLEX, D/ST, K, 7 bench',
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 7 },
  },
  {
    id: 'sleeper-default',
    label: 'Sleeper Default',
    description: 'QB, 2 RB, 2 WR, TE, 2 FLEX, K, DEF, 5 bench',
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, K: 1, DST: 1, BN: 5 },
  },
  {
    id: 'yahoo-standard',
    label: 'Yahoo Standard',
    description: 'QB, 2 RB, 3 WR, TE, W/R/T, K, DEF, 6 bench',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 },
  },
  {
    id: 'superflex',
    label: 'Superflex',
    description: 'QB, 2 RB, 3 WR, TE, 2 FLEX, SUPERFLEX, K, DEF, 6 bench',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPERFLEX: 1, K: 1, DST: 1, BN: 6 },
  },
  {
    id: 'idp-grouped',
    label: 'IDP (DL / LB / DB)',
    description: 'Standard offense plus 2 DL, 2 LB, 2 DB, IDP FLEX — no team defense',
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DL: 2, LB: 2, DB: 2, IDP_FLEX: 1, BN: 7 },
  },
  {
    id: 'idp-individual',
    label: 'IDP (individual positions)',
    description: 'Standard offense plus 2 DE, DT, 2 LB, 2 CB, 2 S',
    slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DE: 2, DT: 1, LB: 2, CB: 2, S: 2, BN: 7 },
  },
  {
    id: 'dynasty-superflex',
    label: 'Dynasty Superflex',
    description: 'QB, 2 RB, 3 WR, TE, 2 FLEX, SUPERFLEX, 15 bench, no K/DEF',
    slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPERFLEX: 1, BN: 15 },
  },
];

export function defaultLeagueSettings(overrides: Partial<LeagueSettings> = {}): LeagueSettings {
  return {
    teamCount: 12,
    leagueStyle: 'redraft',
    maxKeepers: 0,
    scoring: 'ppr',
    rosterSlots: { ...ROSTER_PRESETS[0].slots },
    irSlots: 1,
    ...overrides,
  };
}

export function defaultDraftSettings(overrides: Partial<DraftSettings> = {}): DraftSettings {
  return {
    type: 'snake',
    rounds: 16,
    playerPool: 'all',
    pickTimeSeconds: 90,
    autopickOnTimeout: true,
    thirdRoundReversal: false,
    selectionMode: 'members',
    auction: { budget: 200, minBid: 1, nominationSeconds: 30, bidSeconds: 15 },
    audio: {
      pickSound: 'chime',
      warningSound: 'beep',
      warningThresholdSeconds: 10,
      announceMode: 'tts',
      announcePickTts: true,
      volume: 0.8,
    },
    positionColors: { ...DEFAULT_POSITION_COLORS },
    ...overrides,
  };
}

/** Build a sensible full configuration for a brand new league. */
export function newLeagueConfig(opts: {
  teamCount: number;
  leagueStyle: LeagueSettings['leagueStyle'];
  draftType: DraftSettings['type'];
  presetId?: string;
}): LeagueConfig {
  const preset = ROSTER_PRESETS.find((p) => p.id === opts.presetId) ??
    (opts.leagueStyle === 'dynasty' ? ROSTER_PRESETS.find((p) => p.id === 'dynasty-superflex')! : ROSTER_PRESETS[0]);
  const league = defaultLeagueSettings({
    teamCount: opts.teamCount,
    leagueStyle: opts.leagueStyle,
    maxKeepers: opts.leagueStyle === 'keeper' ? 2 : 0,
    rosterSlots: { ...preset.slots },
  });
  const dynasty = opts.leagueStyle === 'dynasty';
  const draft = defaultDraftSettings({
    type: opts.draftType,
    rounds: dynasty ? 4 : rosterSize(preset.slots),
    playerPool: dynasty ? 'rookies' : 'all',
  });
  return { league, draft };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    // rosterSlots is replaced wholesale so removed slots disappear.
    out[k] = k === 'rosterSlots' ? v : deepMerge((base as Record<string, unknown>)[k], v);
  }
  return out as T;
}

/** Fill any missing fields (e.g. settings saved by an older version) with defaults, then validate. */
export function normalizeLeagueConfig(raw: unknown): LeagueConfig {
  const base: LeagueConfig = { league: defaultLeagueSettings(), draft: defaultDraftSettings() };
  return leagueConfigSchema.parse(deepMerge(base, raw ?? {}));
}
