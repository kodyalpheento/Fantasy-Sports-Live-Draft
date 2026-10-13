import { ROSTER_PRESETS } from '@fsd/core';
import { ActionForm } from '@/components/action-form';
import { Field, PageHeader } from '@/components/ui';
import { requireUser } from '@/lib/auth';
import { createLeagueAction } from '../actions';

export const metadata = { title: 'New league' };

export default async function NewLeaguePage() {
  await requireUser();
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <PageHeader title="Create a football league" subtitle="You can fine-tune every setting on the next screen." back={{ href: '/sports/nfl', label: 'My leagues' }} />
      <div className="card">
        <ActionForm action={createLeagueAction} submitLabel="Create league">
          <Field label="League name"><input className="input" name="name" maxLength={80} placeholder="The Gridiron Gang" required /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Teams">
              <select className="input" name="teamCount" defaultValue="12">
                {Array.from({ length: 31 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} teams</option>)}
              </select>
            </Field>
            <Field label="Draft type">
              <select className="input" name="draftType" defaultValue="snake">
                <option value="snake">Snake</option>
                <option value="linear">Straight (linear)</option>
                <option value="auction">Auction</option>
              </select>
            </Field>
            <Field label="League style">
              <select className="input" name="leagueStyle" defaultValue="redraft">
                <option value="redraft">Redraft — everyone starts fresh</option>
                <option value="keeper">Keeper — keep a few players</option>
                <option value="dynasty">Dynasty — rookie drafts</option>
              </select>
            </Field>
            <Field label="Roster format">
              <select className="input" name="presetId" defaultValue="espn-standard">
                {ROSTER_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" name="joinAsTeam" defaultChecked className="h-4 w-4 accent-emerald-500" /> I&apos;m playing in this league too (give me Team 1)
          </label>
        </ActionForm>
      </div>
    </main>
  );
}
