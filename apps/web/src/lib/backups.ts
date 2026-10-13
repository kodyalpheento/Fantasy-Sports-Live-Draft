import 'server-only';
import { AwsClient } from 'aws4fetch';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/db';
import { appState, backups } from '@/db/schema';
import { onCloudflare } from './cf';
import { decryptSecret, encryptSecret } from './crypto';
import { backupStore, folderStore } from './storage';

/** Tables in a backup, in foreign-key order for restore. Sessions, reset tokens and backup settings are excluded. */
const TABLES = [
  'users', 'leagues', 'league_members', 'media', 'teams', 'invites', 'drafts', 'draft_picks', 'roster_entries', 'players',
] as const;
const BACKUP_FORMAT = 'livedraft-backup';
const SETTINGS_KEY = 'backup_settings';
const SECRET_MASK = '••••••••';

export const backupConfigSchema = z.object({
  auto: z.object({
    enabled: z.boolean(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    timezone: z.string().min(1).max(64),
    days: z.array(z.number().int().min(0).max(6)),
    keep: z.number().int().min(1).max(365),
  }),
  /** Self-hosted: folder for backups. Cloudflare: key prefix inside the R2 bucket. */
  folder: z.string().max(500),
  copy: z.object({
    type: z.enum(['none', 's3', 'b2', 'sharepoint', 'folder']),
    s3: z.object({
      endpoint: z.string().max(300), region: z.string().max(64), bucket: z.string().max(200), prefix: z.string().max(300),
      accessKeyId: z.string().max(300), secretAccessKeyEnc: z.string().max(2000),
    }),
    sharepoint: z.object({
      tenantId: z.string().max(100), clientId: z.string().max(100), clientSecretEnc: z.string().max(2000),
      driveId: z.string().max(300), folderPath: z.string().max(300),
    }),
    folder: z.object({ path: z.string().max(500) }),
  }),
  lastAutoDate: z.string().nullable(),
});
export type BackupConfig = z.infer<typeof backupConfigSchema>;

export function defaultBackupConfig(): BackupConfig {
  return {
    auto: { enabled: false, time: '03:00', timezone: 'America/Chicago', days: [0, 1, 2, 3, 4, 5, 6], keep: 14 },
    folder: '',
    copy: {
      type: 'none',
      s3: { endpoint: '', region: 'auto', bucket: '', prefix: 'livedraft-backups/', accessKeyId: '', secretAccessKeyEnc: '' },
      sharepoint: { tenantId: '', clientId: '', clientSecretEnc: '', driveId: '', folderPath: 'LiveDraft Backups' },
      folder: { path: '' },
    },
    lastAutoDate: null,
  };
}

export async function getBackupConfig(): Promise<BackupConfig> {
  const [row] = await getDb().select().from(appState).where(eq(appState.key, SETTINGS_KEY)).limit(1);
  const base = defaultBackupConfig();
  if (!row) return base;
  const v = row.value as Partial<BackupConfig>;
  const merged = {
    ...base, ...v,
    auto: { ...base.auto, ...v.auto },
    copy: { ...base.copy, ...v.copy, s3: { ...base.copy.s3, ...v.copy?.s3 }, sharepoint: { ...base.copy.sharepoint, ...v.copy?.sharepoint }, folder: { ...base.copy.folder, ...v.copy?.folder } },
  };
  const parsed = backupConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : base;
}

export async function saveBackupConfig(cfg: BackupConfig): Promise<void> {
  const value = backupConfigSchema.parse(cfg);
  await getDb().insert(appState).values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: appState.key, set: { value, updatedAt: new Date() } });
}

/** Secrets are stored encrypted; the settings form shows a mask and only replaces them when a new value is typed. */
export async function mergeSecret(newValue: string | null | undefined, existingEnc: string): Promise<string> {
  if (!newValue || newValue === SECRET_MASK) return existingEnc;
  return encryptSecret(newValue);
}
export const maskSecret = (enc: string) => (enc ? SECRET_MASK : '');

async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Dump every table as JSON (Postgres renders timestamps as ISO and bytea as hex, both of which restore losslessly). */
export async function dumpDatabase(): Promise<Uint8Array> {
  const db = getDb();
  const tables: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    const rows = await db.execute<{ rows: unknown[] }>(sql.raw(`select coalesce(json_agg(t), '[]'::json) as rows from "${t}" t`));
    tables[t] = rows[0]?.rows ?? [];
  }
  const json = JSON.stringify({ format: BACKUP_FORMAT, version: 1, createdAt: new Date().toISOString(), tables });
  return gzip(new TextEncoder().encode(json));
}

export async function restoreDatabase(file: Uint8Array): Promise<void> {
  let text: string;
  try {
    text = new TextDecoder().decode(await gunzip(file));
  } catch {
    text = new TextDecoder().decode(file); // allow an uncompressed .json backup
  }
  const data = JSON.parse(text) as { format?: string; tables?: Record<string, Record<string, unknown>[]> };
  if (data.format !== BACKUP_FORMAT || !data.tables) throw new Error('This file is not a Live Draft backup.');
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`truncate ${TABLES.map((t) => `"${t}"`).join(', ')} cascade`));
    for (const t of TABLES) {
      const rows = data.tables![t] ?? [];
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]).filter((c) => /^[a-z_][a-z0-9_]*$/.test(c));
      const colList = cols.map((c) => `"${c}"`).join(', ');
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = JSON.stringify(rows.slice(i, i + 500));
        await tx.execute(sql`${sql.raw(`insert into "${t}" (${colList}) select ${colList} from json_populate_recordset(null::"${t}", `)}${chunk}::json)`);
      }
    }
  });
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export async function createBackup(kind: 'manual' | 'auto' | 'pre-restore'): Promise<typeof backups.$inferSelect> {
  const cfg = await getBackupConfig();
  const bytes = await dumpDatabase();
  const filename = `livedraft-backup-${stamp(new Date())}-${kind}.json.gz`;
  await backupStore(cfg.folder).put(filename, bytes);
  let copyStatus: string | null = null;
  if (cfg.copy.type !== 'none') {
    try {
      copyStatus = `Copied to ${await copyToTarget(cfg, filename, bytes)}`;
    } catch (err) {
      copyStatus = `Copy failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  const [row] = await getDb().insert(backups).values({ filename, storageKey: filename, sizeBytes: bytes.length, kind, copyStatus }).returning();
  if (kind === 'auto') await pruneAutoBackups(cfg.auto.keep);
  return row;
}

async function pruneAutoBackups(keep: number) {
  const db = getDb();
  const cfg = await getBackupConfig();
  const autos = await db.select().from(backups).where(eq(backups.kind, 'auto')).orderBy(desc(backups.createdAt));
  for (const b of autos.slice(keep)) await deleteBackup(b.id, cfg.folder);
}

export async function deleteBackup(id: string, folder?: string) {
  const db = getDb();
  const [b] = await db.select().from(backups).where(eq(backups.id, id)).limit(1);
  if (!b) return;
  await backupStore(folder ?? (await getBackupConfig()).folder).delete(b.storageKey).catch(() => undefined);
  await db.delete(backups).where(eq(backups.id, id));
}

export async function readBackup(id: string): Promise<{ filename: string; bytes: Uint8Array } | null> {
  const [b] = await getDb().select().from(backups).where(eq(backups.id, id)).limit(1);
  if (!b) return null;
  const bytes = await backupStore((await getBackupConfig()).folder).get(b.storageKey);
  return bytes ? { filename: b.filename, bytes } : null;
}

/** Local date/time parts in the configured time zone. */
function zonedNow(timezone: string, now: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, weekday };
}

/**
 * Called by the cron trigger every 15 minutes. Runs the day's backup once the scheduled time has passed —
 * so if the service was unavailable at that moment, the backup still happens as soon as it is back.
 */
export async function runScheduledBackupIfDue(now = new Date()): Promise<string | null> {
  const cfg = await getBackupConfig();
  if (!cfg.auto.enabled) return null;
  let local;
  try {
    local = zonedNow(cfg.auto.timezone, now);
  } catch {
    local = zonedNow('UTC', now);
  }
  if (!cfg.auto.days.includes(local.weekday) || local.time < cfg.auto.time || cfg.lastAutoDate === local.date) return null;
  await saveBackupConfig({ ...cfg, lastAutoDate: local.date });
  const b = await createBackup('auto');
  return b.filename;
}

async function graphToken(sp: BackupConfig['copy']['sharepoint']): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(sp.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: sp.clientId, client_secret: await decryptSecret(sp.clientSecretEnc),
      scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) throw new Error(`Microsoft sign-in failed (${res.status})`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Upload to a SharePoint document library / OneDrive via Microsoft Graph (upload session, 5 MiB chunks). */
async function uploadToGraph(sp: BackupConfig['copy']['sharepoint'], filename: string, bytes: Uint8Array): Promise<string> {
  const token = await graphToken(sp);
  const folder = sp.folderPath.replace(/^\/+|\/+$/g, '');
  const path = encodeURI(folder ? `${folder}/${filename}` : filename);
  const sessionRes = await fetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(sp.driveId)}/root:/${path}:/createUploadSession`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
  });
  if (!sessionRes.ok) throw new Error(`SharePoint upload session failed (${sessionRes.status})`);
  const { uploadUrl } = (await sessionRes.json()) as { uploadUrl: string };
  const CHUNK = 327_680 * 16;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-length': String(end - start), 'content-range': `bytes ${start}-${end - 1}/${bytes.length}` },
      body: bytes.slice(start, end),
    });
    if (!res.ok && res.status !== 202) throw new Error(`SharePoint upload failed (${res.status})`);
  }
  return `SharePoint/OneDrive: ${folder || '/'}`;
}

async function deleteFromGraph(sp: BackupConfig['copy']['sharepoint'], filename: string) {
  const token = await graphToken(sp);
  const folder = sp.folderPath.replace(/^\/+|\/+$/g, '');
  const path = encodeURI(folder ? `${folder}/${filename}` : filename);
  await fetch(`https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(sp.driveId)}/root:/${path}`, {
    method: 'DELETE', headers: { authorization: `Bearer ${token}` },
  });
}

function s3Client(s3: BackupConfig['copy']['s3'], secret: string) {
  return new AwsClient({ accessKeyId: s3.accessKeyId, secretAccessKey: secret, service: 's3', region: s3.region || 'auto' });
}

function s3Url(s3: BackupConfig['copy']['s3'], filename: string) {
  const endpoint = (/^https?:\/\//.test(s3.endpoint) ? s3.endpoint : `https://${s3.endpoint}`).replace(/\/+$/, '');
  const prefix = s3.prefix.replace(/^\/+/, '');
  return `${endpoint}/${encodeURIComponent(s3.bucket)}/${prefix}${encodeURIComponent(filename)}`;
}

/** Copy a backup to the configured secondary location. Returns a description of where it went. */
export async function copyToTarget(cfg: BackupConfig, filename: string, bytes: Uint8Array): Promise<string> {
  const c = cfg.copy;
  switch (c.type) {
    case 's3':
    case 'b2': {
      if (!c.s3.endpoint || !c.s3.bucket || !c.s3.accessKeyId || !c.s3.secretAccessKeyEnc) throw new Error('Fill in the endpoint, bucket and keys.');
      const client = s3Client(c.s3, await decryptSecret(c.s3.secretAccessKeyEnc));
      const res = await client.fetch(s3Url(c.s3, filename), { method: 'PUT', body: bytes as BodyInit, headers: { 'content-type': 'application/gzip' } });
      if (!res.ok) throw new Error(`${c.type === 'b2' ? 'Backblaze B2' : 'S3'} responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return `${c.type === 'b2' ? 'Backblaze B2' : 'S3'} bucket ${c.s3.bucket}`;
    }
    case 'sharepoint':
      if (!c.sharepoint.tenantId || !c.sharepoint.clientId || !c.sharepoint.clientSecretEnc || !c.sharepoint.driveId) {
        throw new Error('Fill in the tenant, app (client) ID, secret and drive ID.');
      }
      return uploadToGraph(c.sharepoint, filename, bytes);
    case 'folder':
      if (onCloudflare()) throw new Error('Folder copies need a self-hosted (Node) deployment.');
      if (!c.folder.path) throw new Error('Choose a folder.');
      await folderStore(c.folder.path).put(filename, bytes);
      return `folder ${c.folder.path}`;
    default:
      throw new Error('No copy location configured.');
  }
}

/** Write and remove a small file to prove the copy target works. */
export async function testCopyTarget(cfg: BackupConfig): Promise<string> {
  const name = `livedraft-connection-test-${Date.now()}.txt`;
  const where = await copyToTarget(cfg, name, new TextEncoder().encode('Live Draft connection test. Safe to delete.'));
  try {
    if (cfg.copy.type === 's3' || cfg.copy.type === 'b2') {
      await s3Client(cfg.copy.s3, await decryptSecret(cfg.copy.s3.secretAccessKeyEnc)).fetch(s3Url(cfg.copy.s3, name), { method: 'DELETE' });
    } else if (cfg.copy.type === 'sharepoint') {
      await deleteFromGraph(cfg.copy.sharepoint, name);
    } else if (cfg.copy.type === 'folder') {
      await folderStore(cfg.copy.folder.path).delete(name);
    }
  } catch {
    // The upload worked, which is what we're testing.
  }
  return where;
}

export async function testBackupFolder(folder: string): Promise<string> {
  const store = backupStore(folder);
  const name = `livedraft-folder-test-${Date.now()}.txt`;
  await store.put(name, new TextEncoder().encode('test'));
  await store.delete(name);
  return store.location;
}
