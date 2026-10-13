import 'server-only';
import { cfEnv } from './cf';

/** Where backup files live: an R2 bucket on Cloudflare, or a folder on disk when self-hosted on Node. */
export interface BlobStore {
  kind: 'r2' | 'folder';
  location: string;
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

function safeKey(key: string): string {
  if (!/^[\w.-]+$/.test(key)) throw new Error('Invalid file name');
  return key;
}

export function backupStore(folder?: string | null): BlobStore {
  const r2 = cfEnv()?.BACKUPS;
  if (r2) {
    const prefix = (folder ?? '').replace(/^\/+|\/+$/g, '');
    const full = (key: string) => (prefix ? `${prefix}/${safeKey(key)}` : safeKey(key));
    return {
      kind: 'r2',
      location: `R2 bucket${prefix ? ` /${prefix}` : ''}`,
      async put(key, data) { await r2.put(full(key), data); },
      async get(key) {
        const obj = await r2.get(full(key));
        return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
      },
      async delete(key) { await r2.delete(full(key)); },
    };
  }
  const dir = folder?.trim() || process.env.BACKUP_DIR || './data/backups';
  return folderStore(dir);
}

export function folderStore(dir: string): BlobStore {
  const resolve = async (key: string) => {
    const path = await import('node:path');
    return path.resolve(dir, safeKey(key));
  };
  return {
    kind: 'folder',
    location: dir,
    async put(key, data) {
      const fs = await import('node:fs/promises');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(await resolve(key), data);
    },
    async get(key) {
      const fs = await import('node:fs/promises');
      try {
        return new Uint8Array(await fs.readFile(await resolve(key)));
      } catch {
        return null;
      }
    },
    async delete(key) {
      const fs = await import('node:fs/promises');
      await fs.rm(await resolve(key), { force: true });
    },
  };
}
