'use client';

import { useActionState, useState } from 'react';
import type { ActionResult, FormAction } from '@/components/action-form';
import { SubmitButton } from '@/components/action-form';
import { Field } from '@/components/ui';

interface CopyConfig {
  type: 'none' | 's3' | 'b2' | 'sharepoint' | 'folder';
  s3: { endpoint: string; region: string; bucket: string; prefix: string; accessKeyId: string };
  sharepoint: { tenantId: string; clientId: string; driveId: string; folderPath: string };
  folder: { path: string };
}

export function CopyTargetForm({ action, initial, masks, folderAllowed }: {
  action: FormAction; initial: CopyConfig; masks: { s3: string; sp: string }; folderAllowed: boolean;
}) {
  const [state, formAction] = useActionState<ActionResult, FormData>(action, {});
  const [type, setType] = useState(initial.type);
  const s3 = initial.s3;
  const sp = initial.sharepoint;
  const b2 = type === 'b2';
  return (
    <form action={formAction} className="space-y-3">
      <Field label="Where">
        <select name="type" className="input" value={type} onChange={(e) => setType(e.target.value as CopyConfig['type'])}>
          <option value="none">Don&apos;t copy</option>
          <option value="b2">Backblaze B2</option>
          <option value="s3">Other S3-compatible (AWS S3, Wasabi, Cloudflare R2, MinIO…)</option>
          <option value="sharepoint">SharePoint / OneDrive (Office 365)</option>
          <option value="folder" disabled={!folderAllowed}>Local, OneDrive-synced or network (NAS) folder{folderAllowed ? '' : ' — self-hosted only'}</option>
        </select>
      </Field>
      {(type === 's3' || type === 'b2') && (
        <>
          <Field label={b2 ? 'Key ID' : 'Access key ID'}><input className="input" name="s3_key" defaultValue={s3.accessKeyId} autoComplete="off" /></Field>
          <Field label={b2 ? 'Application key' : 'Secret access key'} hint={masks.s3 ? 'Saved. Leave as-is to keep it.' : undefined}>
            <input className="input" name="s3_secret" type="password" defaultValue={masks.s3} autoComplete="new-password" />
          </Field>
          <Field label="Bucket"><input className="input" name="s3_bucket" defaultValue={s3.bucket} /></Field>
          <Field label="Endpoint" hint={b2 ? 'From the bucket page, e.g. s3.us-west-004.backblazeb2.com' : 'e.g. s3.us-east-1.amazonaws.com or <account>.r2.cloudflarestorage.com'}>
            <input className="input" name="s3_endpoint" defaultValue={s3.endpoint} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Region"><input className="input" name="s3_region" defaultValue={s3.region} placeholder={b2 ? 'us-west-004' : 'auto'} /></Field>
            <Field label="Folder / prefix"><input className="input" name="s3_prefix" defaultValue={s3.prefix} /></Field>
          </div>
        </>
      )}
      {type === 'sharepoint' && (
        <>
          <p className="text-xs text-slate-400">Register an app in Microsoft Entra ID with the <code>Files.ReadWrite.All</code> (application) permission, then enter its details and the ID of the document library / OneDrive drive.</p>
          <Field label="Tenant ID"><input className="input" name="sp_tenant" defaultValue={sp.tenantId} /></Field>
          <Field label="App (client) ID"><input className="input" name="sp_client" defaultValue={sp.clientId} /></Field>
          <Field label="Client secret" hint={masks.sp ? 'Saved. Leave as-is to keep it.' : undefined}>
            <input className="input" name="sp_secret" type="password" defaultValue={masks.sp} autoComplete="new-password" />
          </Field>
          <Field label="Drive ID"><input className="input" name="sp_drive" defaultValue={sp.driveId} /></Field>
          <Field label="Folder"><input className="input" name="sp_folder" defaultValue={sp.folderPath} /></Field>
        </>
      )}
      {type === 'folder' && (
        <Field label="Folder path" hint="Any folder the server can write to: a local disk, a OneDrive-synced folder, or a mounted network share (e.g. /mnt/nas/backups or \\\\nas\\backups).">
          <input className="input" name="folder_path" defaultValue={initial.folder.path} />
        </Field>
      )}
      <p className="text-xs text-slate-500">Every new backup (manual or automatic) is copied there in the background.</p>
      <div className="flex gap-2">
        <SubmitButton>Save</SubmitButton>
        <button type="submit" name="intent" value="test" className="btn-secondary">Test connection</button>
      </div>
      {state.error && <p role="alert" className="text-sm text-red-300">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-emerald-300">{state.ok}</p>}
    </form>
  );
}
