import type { DraftSyncPayload } from '@fsd/core';
import { eq, inArray } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { draftPicks, drafts, players, type DraftStatusDb } from '@/db/schema';
import { isInternalRequest } from '@/lib/internal';
import { loadDraft } from '@/lib/leagues';

const STATUS: Record<DraftSyncPayload['status'], DraftStatusDb> = {
  pending: 'scheduled', running: 'in_progress', paused: 'paused', completed: 'completed',
};

/** The realtime worker pushes the full pick list after every change; we mirror it into Postgres. */
export async function POST(req: Request, { params }: { params: Promise<{ draftId: string }> }) {
  if (!(await isInternalRequest(req))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { draftId } = await params;
  const draft = await loadDraft(draftId);
  if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = (await req.json()) as DraftSyncPayload;
  if (!Array.isArray(body.picks) || !STATUS[body.status]) return NextResponse.json({ error: 'Bad payload' }, { status: 400 });

  const db = getDb();
  const teamNames = new Map((draft.config?.teams ?? []).map((t) => [t.id, t.name]));
  const ids = [...new Set(body.picks.map((p) => p.playerId))];
  const info = ids.length ? await db.select().from(players).where(inArray(players.id, ids)) : [];
  const byId = new Map(info.map((p) => [p.id, p]));

  await db.transaction(async (tx) => {
    await tx.delete(draftPicks).where(eq(draftPicks.draftId, draftId));
    if (body.picks.length) {
      await tx.insert(draftPicks).values(body.picks.map((p) => {
        const pl = byId.get(p.playerId);
        return {
          draftId, overall: p.overall, round: p.round, pickInRound: p.pickInRound, teamId: p.teamId,
          teamName: teamNames.get(p.teamId) ?? 'Team', playerId: p.playerId, playerName: pl?.fullName ?? p.playerId,
          position: pl?.position ?? '?', nflTeam: pl?.team ?? null, price: p.price, isKeeper: p.isKeeper, isAuto: p.isAuto,
          madeBy: p.madeBy && /^[0-9a-f-]{36}$/.test(p.madeBy) ? p.madeBy : null,
          pickedAt: p.at ? new Date(p.at) : null,
        };
      }));
    }
    await tx.update(drafts).set({
      status: STATUS[body.status],
      startedAt: body.startedAt ? new Date(body.startedAt) : null,
      completedAt: body.completedAt ? new Date(body.completedAt) : null,
    }).where(eq(drafts.id, draftId));
  });
  return NextResponse.json({ ok: true });
}
