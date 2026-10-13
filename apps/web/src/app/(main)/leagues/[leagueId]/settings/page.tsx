import { desc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { ActionForm, SubmitButton } from '@/components/action-form';
import { Card } from '@/components/ui';
import { getDb } from '@/db';
import { media } from '@/db/schema';
import { requireLeague } from '@/lib/leagues';
import { deleteLeagueAction, saveLeagueSettingsAction, uploadDraftSoundAction } from '../../actions';
import { LeagueSettingsForm } from './settings-form';

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ leagueId: string }>; searchParams: Promise<{ created?: string }> }) {
  const { leagueId } = await params;
  const { created } = await searchParams;
  const { league, config, isCommissioner } = await requireLeague(leagueId);
  if (!isCommissioner) redirect(`/leagues/${leagueId}`);
  const sounds = await getDb().select({ id: media.id, filename: media.filename }).from(media)
    .where(eq(media.leagueId, leagueId)).orderBy(desc(media.createdAt));

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div>
        {created && (
          <div className="mb-6 rounded-xl border border-brand-500/30 bg-brand-500/10 p-4 text-sm text-emerald-200">
            League created! Review the settings below, then invite your league from <b>Teams &amp; members</b>.
          </div>
        )}
        <LeagueSettingsForm key={JSON.stringify(config.draft.audio)} action={saveLeagueSettingsAction.bind(null, leagueId)} initial={config} name={league.name} customSounds={sounds} />
      </div>
      <aside className="space-y-6">
        <Card title="Custom sounds">
          <p className="mb-3 text-sm text-slate-400">Upload your own clips (MP3/WAV/OGG, under 1 MB). Uploading selects it immediately.</p>
          <div className="space-y-4">
            <ActionForm action={uploadDraftSoundAction.bind(null, leagueId, 'pickSound')} submitLabel="Upload pick sound" submitClassName="btn-secondary btn-sm">
              <input type="file" name="file" accept="audio/*" className="block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-ink-700 file:px-2 file:py-1 file:text-slate-200" />
            </ActionForm>
            <ActionForm action={uploadDraftSoundAction.bind(null, leagueId, 'warningSound')} submitLabel="Upload warning sound" submitClassName="btn-secondary btn-sm">
              <input type="file" name="file" accept="audio/*" className="block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-ink-700 file:px-2 file:py-1 file:text-slate-200" />
            </ActionForm>
          </div>
        </Card>
        <Card title="Danger zone">
          <p className="mb-3 text-sm text-slate-400">Deleting the league removes its teams, drafts and history for everyone.</p>
          <form action={deleteLeagueAction.bind(null, leagueId)}>
            <SubmitButton className="btn-danger" confirm={`Permanently delete "${league.name}"? This cannot be undone.`}>Delete league</SubmitButton>
          </form>
        </Card>
      </aside>
    </div>
  );
}
