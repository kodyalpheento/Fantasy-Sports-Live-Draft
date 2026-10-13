import { notFound } from 'next/navigation';
import { DraftRoom } from '@/components/draft/draft-room';
import { requireUser } from '@/lib/auth';
import { draftPageData } from '@/lib/draft-page';
import { leagueRole, loadDraft } from '@/lib/leagues';

export const metadata = { title: 'Draft room' };

export default async function DraftRoomPage({ params }: { params: Promise<{ draftId: string }> }) {
  const { draftId } = await params;
  const user = await requireUser();
  const draft = await loadDraft(draftId);
  if (!draft || !(await leagueRole(draft.leagueId, user.id))) notFound();
  const data = await draftPageData(draft);
  return <DraftRoom draftId={draft.id} leagueId={draft.leagueId} isMock={draft.isMock} {...data} />;
}
