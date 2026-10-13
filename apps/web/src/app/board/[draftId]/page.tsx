import { redirect } from 'next/navigation';
import { notFound } from 'next/navigation';
import { safeEqual } from '@fsd/core';
import { BoardView } from '@/components/draft/board-view';
import { getSession, pendingAuthStep } from '@/lib/auth';
import { draftPageData } from '@/lib/draft-page';
import { leagueRole, loadDraft } from '@/lib/leagues';

export const metadata = { title: 'Draft board' };

/** Remote / big-screen board. League members can open it directly; anyone else needs the commissioner's TV link. */
export default async function BoardPage({ params, searchParams }: { params: Promise<{ draftId: string }>; searchParams: Promise<{ key?: string }> }) {
  const { draftId } = await params;
  const { key } = await searchParams;
  const draft = await loadDraft(draftId);
  if (!draft) notFound();
  const keyOk = !!key && (await safeEqual(key, draft.viewKey));
  if (!keyOk) {
    const s = await getSession();
    if (!s) redirect(`/login?next=${encodeURIComponent(`/board/${draftId}`)}`);
    if (pendingAuthStep(s)) redirect(pendingAuthStep(s)!);
    if (!(await leagueRole(draft.leagueId, s.user.id))) notFound();
  }
  const data = await draftPageData(draft);
  return <BoardView draftId={draft.id} viewKey={keyOk ? key : undefined} {...data} />;
}
