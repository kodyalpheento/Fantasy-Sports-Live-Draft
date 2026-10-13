'use server';

import {
  mapTeams, matchExternalPlayers, newLeagueConfig, normalizeLeagueConfig, parseRosterCsv, rosterSize,
  type ExternalRoster,
} from '@fsd/core';
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { ActionResult } from '@/components/action-form';
import { getDb } from '@/db';
import {
  draftPicks, drafts, invites, leagueMembers, leagues, media, players, rosterEntries, teams, users,
} from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { randomToken, sha256Hex } from '@/lib/crypto';
import { inviteEmail, sendEmail } from '@/lib/email';
import { fetchEspnRosters, fetchSleeperRosters } from '@/lib/imports';
import { currentSeason, isUuid, leagueTeams, requireLeague, type LeagueAccess } from '@/lib/leagues';
import { initDraftRoom } from '@/lib/realtime';

const MAX_AUDIO_BYTES = 1_000_000;

async function commish(leagueId: string): Promise<LeagueAccess | ActionResult> {
  try {
    return await requireLeague(leagueId, { commissioner: true });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Only a commissioner')) return { error: err.message };
    throw err;
  }
}
const denied = (a: LeagueAccess | ActionResult): a is ActionResult => !('league' in a);

function refresh(leagueId: string) {
  revalidatePath(`/leagues/${leagueId}`, 'layout');
}

// ---------------------------------------------------------------- leagues

export async function createLeagueAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = z.object({
    name: z.string().trim().min(2, 'Give the league a name.').max(80),
    teamCount: z.coerce.number().int().min(2).max(32),
    leagueStyle: z.enum(['redraft', 'keeper', 'dynasty']),
    draftType: z.enum(['snake', 'linear', 'auction']),
    presetId: z.string().max(40).optional(),
  }).safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  const { name, teamCount, leagueStyle, draftType, presetId } = parsed.data;
  const settings = newLeagueConfig({ teamCount, leagueStyle, draftType, presetId });
  const joinAsTeam = fd.get('joinAsTeam') === 'on';

  const db = getDb();
  const league = await db.transaction(async (tx) => {
    const [l] = await tx.insert(leagues).values({ name, sport: 'nfl', createdBy: user.id, settings }).returning();
    await tx.insert(leagueMembers).values({ leagueId: l.id, userId: user.id, role: 'commissioner' });
    await tx.insert(teams).values(Array.from({ length: teamCount }, (_, i) => ({
      leagueId: l.id,
      name: i === 0 && joinAsTeam ? `${user.displayName}'s Team` : `Team ${i + 1}`,
      draftOrder: i + 1,
      ownerUserId: i === 0 && joinAsTeam ? user.id : null,
    })));
    return l;
  });
  redirect(`/leagues/${league.id}/settings?created=1`);
}

export async function saveLeagueSettingsAction(leagueId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const access = await commish(leagueId);
  if (denied(access)) return access;
  const name = String(fd.get('name') ?? '').trim();
  if (name.length < 2 || name.length > 80) return { error: 'League name must be 2–80 characters.' };
  let config;
  try {
    config = normalizeLeagueConfig(JSON.parse(String(fd.get('settings') ?? '{}')));
  } catch (err) {
    return { error: err instanceof z.ZodError ? `Invalid setting: ${err.issues[0]?.path.join('.')} — ${err.issues[0]?.message}` : 'Could not read the settings.' };
  }
  if (rosterSize(config.league.rosterSlots) === 0) return { error: 'Add at least one roster spot.' };

  const db = getDb();
  const current = await leagueTeams(leagueId);
  const want = config.league.teamCount;
  if (want > current.length) {
    const maxOrder = Math.max(0, ...current.map((t) => t.draftOrder));
    await db.insert(teams).values(Array.from({ length: want - current.length }, (_, i) => ({
      leagueId, name: `Team ${current.length + i + 1}`, draftOrder: maxOrder + i + 1,
    })));
  } else if (want < current.length) {
    const removable = [...current].reverse().filter((t) => !t.ownerUserId).slice(0, current.length - want);
    if (removable.length < current.length - want) {
      return { error: `To shrink to ${want} teams, first remove owners from the teams you want to delete (Teams & members).` };
    }
    await db.delete(teams).where(inArray(teams.id, removable.map((t) => t.id)));
  }
  await db.update(leagues).set({ name, settings: config }).where(eq(leagues.id, leagueId));
  refresh(leagueId);
  return { ok: 'Settings saved. They apply to drafts that have not opened their draft room yet.' };
}

export async function deleteLeagueAction(leagueId: string): Promise<void> {
  const access = await commish(leagueId);
  if (denied(access)) throw new Error(access.error);
  await getDb().delete(leagues).where(eq(leagues.id, leagueId));
  redirect('/sports/nfl');
}

export async function uploadDraftSoundAction(leagueId: string, kind: 'pickSound' | 'warningSound', _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const access = await commish(leagueId);
  if (denied(access)) return access;
  const stored = await storeAudio(fd.get('file'), access.user.id, leagueId);
  if ('error' in stored) return stored;
  const cfg = access.config;
  cfg.draft.audio[kind] = `media:${stored.id}`;
  await getDb().update(leagues).set({ settings: cfg }).where(eq(leagues.id, leagueId));
  refresh(leagueId);
  return { ok: 'Sound uploaded and selected.' };
}

async function storeAudio(file: FormDataEntryValue | null, userId: string, leagueId: string): Promise<{ id: string } | { error: string }> {
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose an audio file.' };
  if (file.size > MAX_AUDIO_BYTES) return { error: 'Audio files must be under 1 MB.' };
  if (!/^audio\/(mpeg|mp3|wav|x-wav|wave|ogg|webm|aac|mp4|x-m4a)$/.test(file.type)) return { error: 'Use an MP3, WAV, OGG, M4A or WebM audio file.' };
  const [row] = await getDb().insert(media).values({
    uploadedBy: userId, leagueId, filename: file.name.slice(0, 200), contentType: file.type, sizeBytes: file.size,
    data: new Uint8Array(await file.arrayBuffer()),
  }).returning({ id: media.id });
  return row;
}

// ---------------------------------------------------------------- teams

export async function renameTeamAction(leagueId: string, teamId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const access = await requireLeague(leagueId);
  const [team] = await getDb().select().from(teams).where(and(eq(teams.id, teamId), eq(teams.leagueId, leagueId))).limit(1);
  if (!team) return { error: 'Team not found.' };
  if (!access.isCommissioner && team.ownerUserId !== access.user.id) return { error: 'You can only rename your own team.' };
  const name = String(fd.get('name') ?? '').trim();
  if (name.length < 1 || name.length > 40) return { error: 'Team names must be 1–40 characters.' };
  await getDb().update(teams).set({ name }).where(eq(teams.id, teamId));
  refresh(leagueId);
  return { ok: 'Saved.' };
}

export async function moveTeamAction(leagueId: string, teamId: string, direction: 'up' | 'down'): Promise<void> {
  const access = await commish(leagueId);
  if (denied(access)) return;
  const list = await leagueTeams(leagueId);
  const i = list.findIndex((t) => t.id === teamId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await reorder(list.map((t) => t.id));
  refresh(leagueId);
}

export async function randomizeOrderAction(leagueId: string): Promise<void> {
  const access = await commish(leagueId);
  if (denied(access)) return;
  const ids = (await leagueTeams(leagueId)).map((t) => t.id);
  const rand = new Uint32Array(ids.length);
  crypto.getRandomValues(rand);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = rand[i] % (i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  await reorder(ids);
  refresh(leagueId);
}

async function reorder(ids: string[]) {
  const db = getDb();
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries()) await tx.update(teams).set({ draftOrder: i + 1 }).where(eq(teams.id, id));
  });
}

export async function assignOwnerAction(leagueId: string, teamId: string, fd: FormData): Promise<void> {
  const access = await commish(leagueId);
  if (denied(access)) return;
  const userId = String(fd.get('userId') ?? '');
  const db = getDb();
  if (userId) {
    const [m] = await db.select().from(leagueMembers).where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, userId))).limit(1);
    if (!m) return;
  }
  await db.update(teams).set({ ownerUserId: userId || null }).where(and(eq(teams.id, teamId), eq(teams.leagueId, leagueId)));
  refresh(leagueId);
}

export async function uploadTeamAudioAction(leagueId: string, teamId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const access = await requireLeague(leagueId);
  const db = getDb();
  const [team] = await db.select().from(teams).where(and(eq(teams.id, teamId), eq(teams.leagueId, leagueId))).limit(1);
  if (!team) return { error: 'Team not found.' };
  if (!access.isCommissioner && team.ownerUserId !== access.user.id) return { error: 'You can only change your own team.' };
  const stored = await storeAudio(fd.get('file'), access.user.id, leagueId);
  if ('error' in stored) return stored;
  await db.update(teams).set({ announceMediaId: stored.id }).where(eq(teams.id, teamId));
  refresh(leagueId);
  return { ok: 'Announcement uploaded.' };
}

export async function clearTeamAudioAction(leagueId: string, teamId: string): Promise<void> {
  const access = await requireLeague(leagueId);
  const db = getDb();
  const [team] = await db.select().from(teams).where(and(eq(teams.id, teamId), eq(teams.leagueId, leagueId))).limit(1);
  if (!team || (!access.isCommissioner && team.ownerUserId !== access.user.id)) return;
  await db.update(teams).set({ announceMediaId: null }).where(eq(teams.id, teamId));
  refresh(leagueId);
}

// ---------------------------------------------------------------- members & invites

export async function inviteMemberAction(leagueId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const access = await commish(leagueId);
  if (denied(access)) return access;
  const email = z.string().trim().toLowerCase().email().safeParse(fd.get('email'));
  if (!email.success) return { error: 'Enter a valid email address.' };
  const teamId = String(fd.get('teamId') ?? '') || null;
  const db = getDb();
  if (teamId) {
    const [t] = await db.select().from(teams).where(and(eq(teams.id, teamId), eq(teams.leagueId, leagueId))).limit(1);
    if (!t) return { error: 'Team not found.' };
  }
  const [existing] = await db.select({ id: users.id }).from(leagueMembers).innerJoin(users, eq(users.id, leagueMembers.userId))
    .where(and(eq(leagueMembers.leagueId, leagueId), sql`lower(${users.email}) = ${email.data}`)).limit(1);
  if (existing) return { error: 'That person is already in the league.' };

  const token = randomToken();
  await db.insert(invites).values({
    leagueId, email: email.data, teamId, invitedBy: access.user.id, tokenHash: await sha256Hex(token),
    expiresAt: new Date(Date.now() + 14 * 86_400_000),
  });
  const url = `${process.env.APP_URL ?? 'http://localhost:3000'}/invite/${token}`;
  try {
    await sendEmail(inviteEmail(email.data, access.league.name, access.user.displayName, url));
  } catch (err) {
    refresh(leagueId);
    return { error: `Invite saved, but the email could not be sent (${err instanceof Error ? err.message : 'unknown error'}). Share this link instead: ${url}` };
  }
  refresh(leagueId);
  return { ok: `Invite sent to ${email.data}.` };
}

export async function revokeInviteAction(leagueId: string, inviteId: string): Promise<void> {
  const access = await commish(leagueId);
  if (denied(access)) return;
  await getDb().delete(invites).where(and(eq(invites.id, inviteId), eq(invites.leagueId, leagueId), isNull(invites.acceptedAt)));
  refresh(leagueId);
}

export async function removeMemberAction(leagueId: string, userId: string): Promise<void> {
  const access = await commish(leagueId);
  if (denied(access)) return;
  if (userId === access.user.id) return; // commissioners can't remove themselves here
  const db = getDb();
  await db.update(teams).set({ ownerUserId: null }).where(and(eq(teams.leagueId, leagueId), eq(teams.ownerUserId, userId)));
  await db.delete(leagueMembers).where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, userId)));
  refresh(leagueId);
}

export async function setMemberRoleAction(leagueId: string, userId: string, role: 'commissioner' | 'member'): Promise<void> {
  const access = await commish(leagueId);
  if (denied(access)) return;
  if (userId === access.user.id && role === 'member') {
    const others = await getDb().select().from(leagueMembers)
      .where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.role, 'commissioner')));
    if (others.length < 2) return; // a league always keeps at least one commissioner
  }
  await getDb().update(leagueMembers).set({ role }).where(and(eq(leagueMembers.leagueId, leagueId), eq(leagueMembers.userId, userId)));
  refresh(leagueId);
}

export async function acceptInviteAction(token: string): Promise<void> {
  const user = await requireUser();
  const db = getDb();
  const [invite] = await db.select().from(invites).where(eq(invites.tokenHash, await sha256Hex(token))).limit(1);
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) redirect(`/invite/${token}?error=expired`);
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) redirect(`/invite/${token}?error=email`);
  await db.transaction(async (tx) => {
    await tx.insert(leagueMembers).values({ leagueId: invite.leagueId, userId: user.id, role: 'member' }).onConflictDoNothing();
    if (invite.teamId) {
      await tx.update(teams).set({ ownerUserId: user.id }).where(and(eq(teams.id, invite.teamId), isNull(teams.ownerUserId)));
    }
    await tx.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));
  });
  redirect(`/leagues/${invite.leagueId}`);
}

// ---------------------------------------------------------------- drafts

export async function scheduleDraftAction(leagueId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const access = await commish(leagueId);
  if (denied(access)) return access;
  const season = Number(fd.get('season'));
  if (!Number.isInteger(season) || season < 2000 || season > 2100) return { error: 'Enter a valid season year.' };
  const when = String(fd.get('scheduledAt') ?? '');
  const scheduledAt = when ? new Date(when) : null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime())) return { error: 'Invalid date.' };
  const db = getDb();
  const [existing] = await db.select().from(drafts)
    .where(and(eq(drafts.leagueId, leagueId), eq(drafts.season, season), eq(drafts.isMock, false))).limit(1);
  if (existing) {
    if (existing.status !== 'scheduled') return { error: `The ${season} draft has already started.` };
    await db.update(drafts).set({ scheduledAt }).where(eq(drafts.id, existing.id));
  } else {
    await db.insert(drafts).values({ leagueId, season, scheduledAt, isMock: false, viewKey: randomToken(18), createdBy: access.user.id });
  }
  refresh(leagueId);
  return { ok: existing ? 'Draft date updated.' : 'Draft scheduled.' };
}

export async function startMockDraftAction(leagueId: string): Promise<void> {
  const access = await commish(leagueId);
  if (denied(access)) return;
  const [d] = await getDb().insert(drafts).values({
    leagueId, season: currentSeason(), isMock: true, viewKey: randomToken(18), createdBy: access.user.id,
  }).returning();
  redirect(`/drafts/${d.id}`);
}

export async function deleteDraftAction(leagueId: string, draftId: string): Promise<void> {
  const access = await commish(leagueId);
  if (denied(access)) return;
  await getDb().delete(drafts).where(and(eq(drafts.id, draftId), eq(drafts.leagueId, leagueId)));
  refresh(leagueId);
}

/** Throw away a draft room (picks included) and rebuild it from the league's current settings. */
export async function resetDraftAction(leagueId: string, draftId: string, _prev?: ActionResult, _fd?: FormData): Promise<ActionResult> {
  const access = await commish(leagueId);
  if (denied(access)) return access;
  const db = getDb();
  const [draft] = await db.select().from(drafts).where(and(eq(drafts.id, draftId), eq(drafts.leagueId, leagueId))).limit(1);
  if (!draft) return { error: 'Draft not found.' };
  await db.delete(draftPicks).where(eq(draftPicks.draftId, draftId));
  await db.update(drafts).set({ status: 'scheduled', startedAt: null, completedAt: null }).where(eq(drafts.id, draftId));
  try {
    await initDraftRoom({ ...draft, status: 'scheduled' }, { force: true, commissionerId: access.user.id });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not reach the realtime service.' };
  }
  refresh(leagueId);
  revalidatePath(`/drafts/${draftId}`);
  return { ok: 'Draft reset with the current league settings.' };
}

// ---------------------------------------------------------------- rosters & keepers

export async function searchPlayersAction(q: string): Promise<{ id: string; name: string; position: string; team: string | null }[]> {
  await requireUser();
  const term = q.trim();
  if (term.length < 2) return [];
  const rows = await getDb().select({ id: players.id, name: players.fullName, position: players.position, team: players.team })
    .from(players).where(and(eq(players.active, true), ilike(players.fullName, `%${term.replace(/[%_\\]/g, '\\$&')}%`)))
    .orderBy(sql`${players.rank} asc nulls last`, asc(players.fullName)).limit(15);
  return rows;
}

export async function addRosterEntryAction(leagueId: string, season: number, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const access = await commish(leagueId);
  if (denied(access)) return access;
  const teamId = String(fd.get('teamId') ?? '');
  const playerId = String(fd.get('playerId') ?? '');
  if (!isUuid(teamId) || !playerId) return { error: 'Choose a team and a player.' };
  const db = getDb();
  const [player] = await db.select({ id: players.id }).from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) return { error: 'Unknown player.' };
  const round = fd.get('round') ? Number(fd.get('round')) : null;
  const cost = fd.get('cost') ? Number(fd.get('cost')) : null;
  const isKeeper = access.config.league.leagueStyle !== 'redraft' && fd.get('isKeeper') !== 'off';
  const res = await db.insert(rosterEntries).values({ leagueId, season, teamId, playerId, isKeeper, round, cost, source: 'manual' })
    .onConflictDoNothing().returning({ id: rosterEntries.id });
  if (!res.length) return { error: 'That player is already on a roster for this season.' };
  refresh(leagueId);
  return { ok: 'Added.' };
}

export async function updateRosterEntryAction(leagueId: string, entryId: string, fd: FormData): Promise<void> {
  const access = await commish(leagueId);
  if (denied(access)) return;
  const num = (k: string) => {
    const v = String(fd.get(k) ?? '').trim();
    return v === '' ? null : Math.max(0, Math.floor(Number(v)));
  };
  await getDb().update(rosterEntries).set({ isKeeper: fd.get('isKeeper') === 'on', round: num('round'), cost: num('cost') })
    .where(and(eq(rosterEntries.id, entryId), eq(rosterEntries.leagueId, leagueId)));
  refresh(leagueId);
}

export async function removeRosterEntryAction(leagueId: string, entryId: string): Promise<void> {
  const access = await commish(leagueId);
  if (denied(access)) return;
  await getDb().delete(rosterEntries).where(and(eq(rosterEntries.id, entryId), eq(rosterEntries.leagueId, leagueId)));
  refresh(leagueId);
}

export async function clearRostersAction(leagueId: string, season: number): Promise<void> {
  const access = await commish(leagueId);
  if (denied(access)) return;
  await getDb().delete(rosterEntries).where(and(eq(rosterEntries.leagueId, leagueId), eq(rosterEntries.season, season)));
  refresh(leagueId);
}

/** Pull rosters from Sleeper, ESPN or a CSV file into this league for a season. */
export async function importRostersAction(leagueId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const access = await commish(leagueId);
  if (denied(access)) return access;
  const season = Number(fd.get('season'));
  if (!Number.isInteger(season)) return { error: 'Choose a season.' };
  const source = String(fd.get('source'));
  let external: ExternalRoster[];
  try {
    if (source === 'sleeper') external = await fetchSleeperRosters(String(fd.get('externalId') ?? '').trim());
    else if (source === 'espn') {
      external = await fetchEspnRosters(String(fd.get('externalId') ?? '').trim(), Number(fd.get('externalSeason')) || season - 1,
        String(fd.get('espnS2') ?? '').trim() || undefined, String(fd.get('swid') ?? '').trim() || undefined);
    } else {
      const file = fd.get('file');
      if (!(file instanceof File) || file.size === 0) return { error: 'Choose a CSV file.' };
      if (file.size > 2_000_000) return { error: 'CSV files must be under 2 MB.' };
      external = parseRosterCsv(await file.text());
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Import failed.' };
  }
  if (!external.length) return { error: 'No rosters found to import.' };

  const db = getDb();
  const local = await leagueTeams(leagueId);
  const teamMap = mapTeams(external, local);
  const all = await db.select({
    id: players.id, fullName: players.fullName, position: players.position, team: players.team, espnId: players.espnId, yahooId: players.yahooId,
  }).from(players);
  const dynasty = access.config.league.leagueStyle === 'dynasty';
  const replace = fd.get('replace') === 'on';

  if (replace) await db.delete(rosterEntries).where(and(eq(rosterEntries.leagueId, leagueId), eq(rosterEntries.season, season)));
  let added = 0;
  const unmatched: string[] = [];
  for (const ext of external) {
    const team = teamMap.get(ext);
    if (!team) continue;
    const { matched, unmatched: miss } = matchExternalPlayers(ext.players, all);
    unmatched.push(...miss.map((m) => m.name));
    if (!matched.length) continue;
    const res = await db.insert(rosterEntries).values(matched.map((m) => ({
      leagueId, season, teamId: team.id, playerId: m.playerId,
      // Dynasty rosters carry over in full; in keeper leagues the commissioner picks keepers afterwards
      // (rows from a CSV with a round or cost are treated as keepers).
      isKeeper: dynasty || m.external.round != null || m.external.cost != null,
      round: m.external.round ?? null, cost: m.external.cost ?? null, source,
    }))).onConflictDoNothing().returning({ id: rosterEntries.id });
    added += res.length;
  }
  refresh(leagueId);
  const skippedTeams = external.length - teamMap.size;
  return {
    ok: `Imported ${added} players onto ${teamMap.size} teams.` +
      (skippedTeams > 0 ? ` ${skippedTeams} extra team(s) skipped — add more teams first.` : '') +
      (unmatched.length ? ` Could not match: ${unmatched.slice(0, 12).join(', ')}${unmatched.length > 12 ? '…' : ''}.` : ''),
  };
}

export async function latestDraftSeason(leagueId: string): Promise<number> {
  const [d] = await getDb().select({ season: drafts.season }).from(drafts)
    .where(and(eq(drafts.leagueId, leagueId), eq(drafts.isMock, false))).orderBy(desc(drafts.season)).limit(1);
  return d?.season ?? currentSeason();
}
