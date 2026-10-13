import { getCloudflareContext } from '@opennextjs/cloudflare';

/** Cloudflare bindings when running on Workers; undefined under plain Node (local dev / self-hosting). */
export function cfEnv(): CloudflareEnv | undefined {
  try {
    return getCloudflareContext().env as CloudflareEnv;
  } catch {
    return undefined;
  }
}

export function onCloudflare(): boolean {
  return !!cfEnv()?.HYPERDRIVE;
}
