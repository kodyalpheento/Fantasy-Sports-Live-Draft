import { sql } from 'drizzle-orm';
import {
  boolean, customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import type { DraftConfig, LeagueConfig, Position } from '@fsd/core';

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  isAdmin: boolean('is_admin').notNull().default(false),
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  totpLastStep: integer('totp_last_step'),
  mfaOptOut: boolean('mfa_opt_out').notNull().default(false),
  failedLogins: integer('failed_logins').notNull().default(0),
  lockedUntil: ts('locked_until'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('users_email_idx').on(sql`lower(${t.email})`)]);

export const sessions = pgTable('sessions', {
  /** SHA-256 of the session token; the token itself only lives in the browser cookie. */
  id: text('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mfaVerified: boolean('mfa_verified').notNull().default(false),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

export const passwordResets = pgTable('password_resets', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
});

export const leagues = pgTable('leagues', {
  id: uuid('id').primaryKey().defaultRandom(),
  sport: text('sport').notNull().default('nfl'),
  name: text('name').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  settings: jsonb('settings').$type<LeagueConfig>().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const leagueMembers = pgTable('league_members', {
  leagueId: uuid('league_id').notNull().references(() => leagues.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<'commissioner' | 'member'>().notNull().default('member'),
  joinedAt: ts('joined_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.leagueId, t.userId] }), index('league_members_user_idx').on(t.userId)]);

export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  leagueId: uuid('league_id').references(() => leagues.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  data: bytea('data').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  draftOrder: integer('draft_order').notNull(),
  /** Audio clip played when this team goes on the clock. */
  announceMediaId: uuid('announce_media_id').references(() => media.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('teams_league_idx').on(t.leagueId)]);

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  expiresAt: ts('expires_at').notNull(),
  acceptedAt: ts('accepted_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('invites_league_idx').on(t.leagueId)]);

export type DraftStatusDb = 'scheduled' | 'in_progress' | 'paused' | 'completed';

export const drafts = pgTable('drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id, { onDelete: 'cascade' }),
  season: integer('season').notNull(),
  isMock: boolean('is_mock').notNull().default(false),
  status: text('status').$type<DraftStatusDb>().notNull().default('scheduled'),
  scheduledAt: ts('scheduled_at'),
  startedAt: ts('started_at'),
  completedAt: ts('completed_at'),
  /** Secret for the read-only remote board link. */
  viewKey: text('view_key').notNull(),
  /** Settings/teams frozen when the draft room was created. */
  config: jsonb('config').$type<DraftConfig>(),
  initializedAt: ts('initialized_at'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('drafts_league_idx').on(t.leagueId)]);

export const draftPicks = pgTable('draft_picks', {
  draftId: uuid('draft_id').notNull().references(() => drafts.id, { onDelete: 'cascade' }),
  overall: integer('overall').notNull(),
  round: integer('round').notNull(),
  pickInRound: integer('pick_in_round').notNull(),
  teamId: uuid('team_id').notNull(),
  teamName: text('team_name').notNull(),
  playerId: text('player_id').notNull(),
  // Snapshot of the player at pick time so history stays accurate after trades / retirements.
  playerName: text('player_name').notNull(),
  position: text('position').notNull(),
  nflTeam: text('nfl_team'),
  price: integer('price'),
  isKeeper: boolean('is_keeper').notNull().default(false),
  isAuto: boolean('is_auto').notNull().default(false),
  madeBy: uuid('made_by'),
  pickedAt: ts('picked_at'),
}, (t) => [primaryKey({ columns: [t.draftId, t.overall] })]);

/** Players a team holds going into a season's draft: imported rosters, keepers, dynasty rosters. */
export const rosterEntries = pgTable('roster_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id, { onDelete: 'cascade' }),
  season: integer('season').notNull(),
  teamId: uuid('team_id').notNull().references(() => teams.id, { onDelete: 'cascade' }),
  playerId: text('player_id').notNull(),
  isKeeper: boolean('is_keeper').notNull().default(false),
  round: integer('round'),
  cost: integer('cost'),
  source: text('source').notNull().default('manual'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('roster_entries_unique').on(t.leagueId, t.season, t.playerId)]);

export const players = pgTable('players', {
  /** Sleeper player id (team abbreviation for defenses). */
  id: text('id').primaryKey(),
  fullName: text('full_name').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  position: text('position').$type<Position>().notNull(),
  positions: jsonb('positions').$type<Position[]>().notNull(),
  team: text('team'),
  rank: integer('rank'),
  age: integer('age'),
  yearsExp: integer('years_exp'),
  rookie: boolean('rookie').notNull().default(false),
  status: text('status'),
  injuryStatus: text('injury_status'),
  espnId: text('espn_id'),
  yahooId: text('yahoo_id'),
  headshotUrl: text('headshot_url'),
  active: boolean('active').notNull().default(true),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [index('players_name_idx').on(t.fullName), index('players_espn_idx').on(t.espnId)]);

export const appState = pgTable('app_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const backups = pgTable('backups', {
  id: uuid('id').primaryKey().defaultRandom(),
  filename: text('filename').notNull(),
  storageKey: text('storage_key').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  kind: text('kind').$type<'manual' | 'auto' | 'pre-restore'>().notNull(),
  copyStatus: text('copy_status'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type League = typeof leagues.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Draft = typeof drafts.$inferSelect;
export type DraftPickRow = typeof draftPicks.$inferSelect;
export type PlayerRow = typeof players.$inferSelect;
