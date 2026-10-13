import { desc } from 'drizzle-orm';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Badge, Card, Empty, Field, formatDate } from '@/components/ui';
import { getDb } from '@/db';
import { backups } from '@/db/schema';
import { getBackupConfig } from '@/lib/backups';
import { onCloudflare } from '@/lib/cf';
import { backupStore } from '@/lib/storage';
import {
  backupNowAction, backupSecretsMasked, deleteBackupAction, restoreBackupAction, saveCopyTargetAction, saveScheduleAction, testFolderAction,
} from '../actions';
import { CopyTargetForm } from './copy-form';

export const metadata = { title: 'Backups' };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function size(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

export default async function BackupsPage() {
  const [cfg, rows, masks] = await Promise.all([
    getBackupConfig(),
    getDb().select().from(backups).orderBy(desc(backups.createdAt)).limit(200),
    backupSecretsMasked(),
  ]);
  const cloud = onCloudflare();
  const store = backupStore(cfg.folder);
  const last = rows[0];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <Card title="Backups" actions={<ActionForm action={backupNowAction} submitLabel="Back up now" inline />}>
        <p className="text-sm text-slate-400">A backup contains the database — users, leagues, teams, settings, drafts, results, rosters, player data and uploaded audio. Keep a copy somewhere other than this server.</p>
        <p className="mt-3 text-sm"><span className="font-semibold text-white">Saving to:</span> <code className="text-slate-300">{store.location}</code></p>
        {last && <p className="mt-1 text-xs text-slate-500">Last backup {formatDate(last.createdAt)} · <code>{last.filename}</code></p>}
        <div className="mt-4 overflow-x-auto">
          {rows.length === 0 ? <Empty>No backups yet.</Empty> : (
            <table className="w-full text-sm">
              <thead className="bg-ink-950/50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-2 py-2">Backup</th><th>Made</th><th>Size</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="table-row">
                    <td className="px-2 py-2">
                      <code className="text-xs text-slate-200">{b.filename}</code>{' '}
                      <Badge color={b.kind === 'auto' ? 'blue' : b.kind === 'pre-restore' ? 'amber' : 'slate'}>{b.kind}</Badge>
                      {b.copyStatus && <div className={`text-[11px] ${b.copyStatus.startsWith('Copy failed') ? 'text-red-300' : 'text-slate-500'}`}>{b.copyStatus}</div>}
                    </td>
                    <td className="whitespace-nowrap text-slate-300">{formatDate(b.createdAt)}</td>
                    <td className="text-slate-400">{size(b.sizeBytes)}</td>
                    <td className="whitespace-nowrap text-right">
                      <a href={`/api/admin/backups/${b.id}`} className="btn-secondary btn-sm">Download</a>{' '}
                      <form action={deleteBackupAction.bind(null, b.id)} className="inline">
                        <SubmitButton className="btn-ghost btn-sm text-red-300" confirm="Delete this backup?">Delete</SubmitButton>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <div className="space-y-6">
        <Card title="Automatic backups">
          <ActionForm action={saveScheduleAction} submitLabel="Save" submitClassName="btn-secondary">
            <label className="flex items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" name="enabled" defaultChecked={cfg.auto.enabled} className="h-4 w-4 accent-emerald-500" /> Make automatic backups
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="At this time"><input className="input" type="time" name="time" defaultValue={cfg.auto.time} /></Field>
              <Field label="Backups to keep"><input className="input" type="number" name="keep" min={1} max={365} defaultValue={cfg.auto.keep} /></Field>
            </div>
            <Field label="Time zone"><input className="input" name="timezone" defaultValue={cfg.auto.timezone} placeholder="America/Chicago" /></Field>
            <fieldset className="rounded-lg border border-white/10 p-3">
              <legend className="px-1 text-xs text-slate-400">On these days</legend>
              <div className="flex flex-wrap gap-3">
                {DAYS.map((d, i) => (
                  <label key={d} className="flex items-center gap-1 text-sm text-slate-200">
                    <input type="checkbox" name="days" value={i} defaultChecked={cfg.auto.days.includes(i)} className="accent-emerald-500" /> {d}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="text-xs text-slate-500">If the service is unavailable at that time, the backup runs as soon as it&apos;s back.</p>
            <Field label={cloud ? 'Folder inside the backup bucket' : 'Save backups in this folder'} hint={cloud ? 'Optional prefix in the R2 bucket.' : `Blank = ${process.env.BACKUP_DIR || './data/backups'}. Any folder on the server, a USB drive, or a mounted network share.`}>
              <input className="input" name="folder" defaultValue={cfg.folder} placeholder={cloud ? 'backups/' : 'Blank = the default backups folder'} />
            </Field>
          </ActionForm>
          {!cloud && (
            <div className="mt-2">
              <ActionForm action={testFolderAction} submitLabel="Test folder" submitClassName="btn-ghost btn-sm">
                <input type="hidden" name="folder" value={cfg.folder} />
              </ActionForm>
            </div>
          )}
        </Card>

        <Card title="Copy backups elsewhere">
          <CopyTargetForm
            action={saveCopyTargetAction}
            masks={masks}
            folderAllowed={!cloud}
            initial={{
              type: cfg.copy.type,
              s3: { endpoint: cfg.copy.s3.endpoint, region: cfg.copy.s3.region, bucket: cfg.copy.s3.bucket, prefix: cfg.copy.s3.prefix, accessKeyId: cfg.copy.s3.accessKeyId },
              sharepoint: { tenantId: cfg.copy.sharepoint.tenantId, clientId: cfg.copy.sharepoint.clientId, driveId: cfg.copy.sharepoint.driveId, folderPath: cfg.copy.sharepoint.folderPath },
              folder: cfg.copy.folder,
            }}
          />
        </Card>

        <Card title="Restore from a backup">
          <ActionForm action={restoreBackupAction} submitLabel="Restore…" submitClassName="btn-danger">
            <p className="text-sm text-slate-300"><b>This replaces all current data</b> with the backup&apos;s. A safety backup of the current data is made first. Everyone will need to sign in again.</p>
            <input type="file" name="file" accept=".gz,.json,application/gzip,application/json" required className="block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-ink-700 file:px-2 file:py-1 file:text-slate-200" />
            <Field label='Type "RESTORE" to confirm'><input className="input" name="confirm" autoComplete="off" /></Field>
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
