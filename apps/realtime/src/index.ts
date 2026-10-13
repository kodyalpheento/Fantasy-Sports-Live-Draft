import { safeEqual, verifyRealtimeToken } from '@fsd/core';
import { DraftRoom } from './draft-room';
import { callApp, type Env } from './env';

export { DraftRoom };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function isServerCall(req: Request, env: Env): Promise<boolean> {
  const auth = req.headers.get('authorization') ?? '';
  return !!env.REALTIME_SECRET && auth.startsWith('Bearer ') && (await safeEqual(auth.slice(7), env.REALTIME_SECRET));
}

function originAllowed(req: Request, env: Env): boolean {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) return true;
  const origin = req.headers.get('origin');
  return !origin || allowed.includes(origin);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') return json({ ok: true });

    const m = url.pathname.match(/^\/drafts\/([0-9a-zA-Z-]{1,64})\/(ws|init|state)$/);
    if (!m) return json({ error: 'Not found' }, 404);
    const [, draftId, action] = m;
    const stub = env.DRAFT_ROOM.get(env.DRAFT_ROOM.idFromName(draftId));

    if (action === 'ws') {
      if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'Expected a WebSocket upgrade' }, 426);
      if (!originAllowed(req, env)) return json({ error: 'Origin not allowed' }, 403);
      const payload = await verifyRealtimeToken(url.searchParams.get('token'), env.REALTIME_SECRET);
      if (!payload || payload.draftId !== draftId) return json({ error: 'Invalid or expired token' }, 401);
      const headers = new Headers(req.headers);
      headers.set('x-actor', JSON.stringify(payload));
      headers.set('x-draft-id', draftId);
      return stub.fetch(new Request(`https://room/${action}`, { headers }));
    }

    if (!(await isServerCall(req, env))) return json({ error: 'Unauthorized' }, 401);
    return stub.fetch(new Request(`https://room/${action}`, {
      method: req.method,
      headers: { 'content-type': 'application/json', 'x-draft-id': draftId },
      body: req.method === 'GET' ? undefined : await req.text(),
    }));
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      callApp(env, '/api/internal/cron', { method: 'POST', body: '{}' })
        .then(async (r) => { if (!r.ok) console.error('cron call failed', r.status, await r.text()); })
        .catch((err) => console.error('cron call failed', err)),
    );
  },
} satisfies ExportedHandler<Env>;
