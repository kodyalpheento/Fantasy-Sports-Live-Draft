'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { ActionResult } from '@/components/action-form';
import { getDb } from '@/db';
import { sessions, users } from '@/db/schema';
import { requireAdmin } from '@/lib/auth';
import {
  createBackup, deleteBackup, getBackupConfig, maskSecret, mergeSecret, restoreDatabase, saveBackupConfig, testBackupFolder,
  testCopyTarget, type BackupConfig,
} from '@/lib/backups';
import { syncPlayersFromSleeper } from '@/lib/players';

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function syncPlayersAction(_prev: ActionResult): Promise<ActionResult> {
  await requireAdmin();
  const r = await syncPlayersFromSleeper();
  revalidatePath('/admin');
  return r.ok ? { ok: `Updated ${r.count} players from Sleeper.` } : { error: `Sync failed: ${r.error}` };
}

export async function resetUserMfaAction(userId: string): Promise<void> {
  const admin = await requireAdmin();
  if (userId === admin.id) return;
  const db = getDb();
  await db.update(users).set({ totpEnabled: false, totpSecretEnc: null, totpLastStep: null }).where(eq(users.id, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  revalidatePath('/admin');
}

export async function toggleAdminAction(userId: string): Promise<void> {
  const admin = await requireAdmin();
  if (userId === admin.id) return;
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u) return;
  await db.update(users).set({ isAdmin: !u.isAdmin }).where(eq(users.id, userId));
  // New admins must have 2FA; sign them out so it is enforced on next sign-in.
  await db.delete(sessions).where(eq(sessions.userId, userId));
  revalidatePath('/admin');
}

export async function backupNowAction(_prev: ActionResult): Promise<ActionResult> {
  await requireAdmin();
  try {
    const b = await createBackup('manual');
    revalidatePath('/admin/backups');
    return { ok: `Backup ${b.filename} created.${b.copyStatus ? ` ${b.copyStatus}.` : ''}` };
  } catch (err) {
    return { error: `Backup failed: ${msg(err)}` };
  }
}

export async function deleteBackupAction(id: string): Promise<void> {
  await requireAdmin();
  await deleteBackup(id);
  revalidatePath('/admin/backups');
}

export async function saveScheduleAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const cfg = await getBackupConfig();
  const days = fd.getAll('days').map(Number).filter((d) => d >= 0 && d <= 6);
  const next: BackupConfig = {
    ...cfg,
    auto: {
      enabled: fd.get('enabled') === 'on',
      time: String(fd.get('time') || cfg.auto.time),
      timezone: String(fd.get('timezone') || cfg.auto.timezone),
      days,
      keep: Math.max(1, Math.min(365, Number(fd.get('keep')) || cfg.auto.keep)),
    },
    folder: String(fd.get('folder') ?? '').trim(),
  };
  try {
    Intl.DateTimeFormat('en-US', { timeZone: next.auto.timezone });
  } catch {
    return { error: 'Unknown time zone. Use a name like America/Chicago.' };
  }
  try {
    await saveBackupConfig(next);
  } catch (err) {
    return { error: msg(err) };
  }
  revalidatePath('/admin/backups');
  return { ok: 'Schedule saved.' };
}

export async function testFolderAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    return { ok: `OK — backups can be written to ${await testBackupFolder(String(fd.get('folder') ?? '').trim())}.` };
  } catch (err) {
    return { error: `Can't write there: ${msg(err)}` };
  }
}

async function copyConfigFrom(fd: FormData): Promise<BackupConfig> {
  const cfg = await getBackupConfig();
  const type = String(fd.get('type')) as BackupConfig['copy']['type'];
  const s = (k: string) => String(fd.get(k) ?? '').trim();
  return {
    ...cfg,
    copy: {
      type: ['none', 's3', 'b2', 'sharepoint', 'folder'].includes(type) ? type : 'none',
      s3: {
        endpoint: s('s3_endpoint'), region: s('s3_region') || 'auto', bucket: s('s3_bucket'), prefix: s('s3_prefix'),
        accessKeyId: s('s3_key'), secretAccessKeyEnc: await mergeSecret(s('s3_secret'), cfg.copy.s3.secretAccessKeyEnc),
      },
      sharepoint: {
        tenantId: s('sp_tenant'), clientId: s('sp_client'), clientSecretEnc: await mergeSecret(s('sp_secret'), cfg.copy.sharepoint.clientSecretEnc),
        driveId: s('sp_drive'), folderPath: s('sp_folder'),
      },
      folder: { path: s('folder_path') },
    },
  };
}

export async function saveCopyTargetAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  try {
    const cfg = await copyConfigFrom(fd);
    await saveBackupConfig(cfg);
    revalidatePath('/admin/backups');
    if (fd.get('intent') === 'test') {
      if (cfg.copy.type === 'none') return { error: 'Choose where to copy backups first.' };
      return { ok: `Connection works — test file written to ${await testCopyTarget(cfg)}.` };
    }
    return { ok: 'Saved. Every new backup is copied there automatically.' };
  } catch (err) {
    return { error: msg(err) };
  }
}

export async function restoreBackupAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a backup file.' };
  if (fd.get('confirm') !== 'RESTORE') return { error: 'Type RESTORE to confirm.' };
  try {
    await createBackup('pre-restore');
    await restoreDatabase(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    return { error: `Restore failed (nothing was changed): ${msg(err)}` };
  }
  // Sessions are not part of a backup, so everyone (including us) signs in again.
  revalidatePath('/', 'layout');
  redirect('/login?restored=1');
}

export async function backupSecretsMasked(): Promise<{ s3: string; sp: string }> {
  await requireAdmin();
  const cfg = await getBackupConfig();
  return { s3: maskSecret(cfg.copy.s3.secretAccessKeyEnc), sp: maskSecret(cfg.copy.sharepoint.clientSecretEnc) };
}
