import { safeEqual } from '@fsd/core';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { teams } from '@/db/schema';
import { apiUser } from '@/lib/auth';
import { leagueRole, loadDraft } from '@/lib/leagues';
import { initDraftRoom, issueRealtimeToken, realtimeWsUrl } from '@/lib/realtime';

/** Issue a short-lived token for the draft room WebSocket, creating the room on first use. */
export async function POST(req: Request, { params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  const draft = await loadDraft(draftId);
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { key?: string };

  const user = await apiUser();
  const role = user ? await leagueRole(draft.leagueId, user.id) : null;
  let payload: { userId: string | null; name: string; role: 'commissioner' | 'member' | 'viewer'; teamIds: string[] };
  if (user && role) {
    const owned = await getDb().select({ id: teams.id }).from(teams).where(and(eq(teams.leagueId, draft.leagueId), eq(teams.ownerUserId, user.id)));
    payload = { userId: user.id, name: user.displayName, role, teamIds: owned.map((t) => t.id) };
  } else if (body.key && (await safeEqual(body.key, draft.viewKey))) {
    payload = { userId: null, name: 'Board viewer', role: 'viewer', teamIds: [] };
  } else {
    return NextResponse.json({ error: user ? 'You are not in this league.' : 'Sign in to join this draft.' }, { status: user ? 403 : 401 });
  }

  if (!draft.initializedAt) {
    try {
      await initDraftRoom(draft, { commissionerId: draft.createdBy ?? undefined });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not open the draft room.' }, { status: 502 });
    }
  }
  const token = await issueRealtimeToken({ draftId, ...payload });
  return NextResponse.json({ token, wsUrl: `${realtimeWsUrl()}/drafts/${draftId}/ws` }, { headers: { 'cache-control': 'no-store' } });
}
