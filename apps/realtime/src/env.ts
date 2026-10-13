import type { DraftRoom } from './draft-room';

export interface Env {
  DRAFT_ROOM: DurableObjectNamespace<DraftRoom>;
  REALTIME_SECRET: string;
  APP_URL: string;
  ALLOWED_ORIGINS?: string;
  /** Optional service binding to the web app worker. */
  APP?: Fetcher;
}

/** Call the web app, through the service binding when configured. */
export function callApp(env: Env, path: string, init: RequestInit): Promise<Response> {
  const url = new URL(path, env.APP_URL).toString();
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${env.REALTIME_SECRET}`);
  headers.set('content-type', 'application/json');
  return env.APP ? env.APP.fetch(url, { ...init, headers }) : fetch(url, { ...init, headers });
}

