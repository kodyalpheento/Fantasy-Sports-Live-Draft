'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import type { ActionResult, FormAction } from '@/components/action-form';
import { SubmitButton } from '@/components/action-form';
import { Field } from '@/components/ui';

type Hit = { id: string; name: string; position: string; team: string | null };

export function PlayerSearch({ search }: { search: (q: string) => Promise<Hit[]> }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [chosen, setChosen] = useState<Hit | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (chosen || q.trim().length < 2) { setHits([]); return; }
    timer.current = setTimeout(() => { void search(q).then(setHits); }, 200);
  }, [q, chosen, search]);
  return (
    <div className="relative">
      <input type="hidden" name="playerId" value={chosen?.id ?? ''} />
      <input className="input" placeholder="Search players…" value={chosen ? `${chosen.name} (${chosen.position}${chosen.team ? `, ${chosen.team}` : ''})` : q}
        onChange={(e) => { setChosen(null); setQ(e.target.value); }} />
      {hits.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-white/10 bg-ink-850 shadow-xl">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className="flex w-full justify-between px-3 py-2 text-left text-sm hover:bg-white/5" onClick={() => { setChosen(h); setHits([]); }}>
                <span className="text-white">{h.name}</span><span className="text-slate-400">{h.position} · {h.team ?? 'FA'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ImportForm({ action, season }: { action: FormAction; season: number }) {
  const [state, formAction] = useActionState<ActionResult, FormData>(action, {});
  const [source, setSource] = useState<'sleeper' | 'espn' | 'csv'>('sleeper');
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="season" value={season} />
      <div className="flex gap-1 rounded-lg bg-ink-950/60 p-1 text-sm">
        {(['sleeper', 'espn', 'csv'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setSource(s)}
            className={`flex-1 rounded-md px-2 py-1.5 font-medium ${source === s ? 'bg-ink-700 text-white' : 'text-slate-400'}`}>
            {s === 'csv' ? 'CSV / Yahoo' : s === 'espn' ? 'ESPN' : 'Sleeper'}
          </button>
        ))}
      </div>
      <input type="hidden" name="source" value={source} />
      {source === 'sleeper' && (
        <Field label="Sleeper league ID" hint="The number in your league's URL on sleeper.com.">
          <input className="input" name="externalId" inputMode="numeric" required />
        </Field>
      )}
      {source === 'espn' && (
        <>
          <Field label="ESPN league ID" hint="leagueId= in your league's URL.">
            <input className="input" name="externalId" inputMode="numeric" required />
          </Field>
          <Field label="ESPN season to read"><input className="input" name="externalSeason" type="number" defaultValue={season - 1} /></Field>
          <details className="text-xs text-slate-400">
            <summary className="cursor-pointer">Private league? Add your ESPN cookies</summary>
            <p className="mt-2">Find <code>espn_s2</code> and <code>SWID</code> in your browser&apos;s cookies for espn.com. They&apos;re used for this import only and never stored.</p>
            <div className="mt-2 space-y-2">
              <input className="input" name="espnS2" placeholder="espn_s2" autoComplete="off" />
              <input className="input" name="swid" placeholder="SWID {…}" autoComplete="off" />
            </div>
          </details>
        </>
      )}
      {source === 'csv' && (
        <Field label="CSV file" hint="Columns: Team, Player, Position, NFL Team, and optionally Round, Cost, Yahoo ID / ESPN ID / Sleeper ID. Yahoo has no public import, so export your rosters to a spreadsheet and save as CSV.">
          <input type="file" name="file" accept=".csv,text/csv" required className="block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-ink-700 file:px-2 file:py-1 file:text-slate-200" />
        </Field>
      )}
      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input type="checkbox" name="replace" className="h-4 w-4 accent-emerald-500" /> Replace existing rosters for {season}
      </label>
      <SubmitButton pendingLabel="Importing…">Import rosters</SubmitButton>
      {state.error && <p role="alert" className="text-sm text-red-300">{state.error}</p>}
      {state.ok && <p role="status" className="text-sm text-emerald-300">{state.ok}</p>}
    </form>
  );
}
