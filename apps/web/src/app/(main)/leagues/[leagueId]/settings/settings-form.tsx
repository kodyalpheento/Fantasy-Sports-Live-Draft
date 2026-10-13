'use client';

import {
  DEFAULT_POSITION_COLORS, IDP_POSITIONS, OFFENSE_POSITIONS, ROSTER_PRESETS, SLOT_LABELS, eligiblePositions, rosterSize,
  type LeagueConfig, type Position, type RosterSlots, type SlotType,
} from '@fsd/core';
import { useActionState, useState, type ReactNode } from 'react';
import type { ActionResult, FormAction } from '@/components/action-form';
import { SubmitButton } from '@/components/action-form';
import { playSound, speak, unlockAudio } from '@/components/draft/audio';

const OFFENSE_SLOTS: SlotType[] = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPERFLEX', 'K', 'DST'];
const IDP_GROUPED: SlotType[] = ['DL', 'LB', 'DB', 'IDP_FLEX'];
const IDP_INDIVIDUAL: SlotType[] = ['DE', 'DT', 'LB', 'CB', 'S', 'IDP_FLEX'];
const SOUNDS = [
  ['none', 'No sound'], ['chime', 'Chime'], ['horn', 'Stadium horn'], ['whistle', 'Referee whistle'], ['beep', 'Beep'], ['buzzer', 'Buzzer'],
] as const;

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="card">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-slate-400">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid items-center gap-2 border-b border-white/5 py-3 last:border-0 sm:grid-cols-[1fr_240px]">
      <div>
        <div className="text-sm font-medium text-slate-100">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Stepper({ value, onChange, min = 0, max = 20 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <div className="inline-flex items-center overflow-hidden rounded-lg border border-white/10">
      <button type="button" className="px-3 py-1.5 text-slate-300 hover:bg-white/5" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Decrease">−</button>
      <span className="w-10 text-center font-mono text-white">{value}</span>
      <button type="button" className="px-3 py-1.5 text-slate-300 hover:bg-white/5" onClick={() => onChange(Math.min(max, value + 1))} aria-label="Increase">+</button>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-brand-500' : 'bg-ink-600'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${checked ? 'left-5' : 'left-0.5'}`} />
    </button>
  );
}

export function LeagueSettingsForm({
  action, initial, name: initialName, customSounds,
}: {
  action: FormAction;
  initial: LeagueConfig;
  name: string;
  customSounds: { id: string; filename: string }[];
}) {
  const [state, formAction] = useActionState<ActionResult, FormData>(action, {});
  const [name, setName] = useState(initialName);
  const [cfg, setCfg] = useState<LeagueConfig>(initial);
  const L = cfg.league;
  const D = cfg.draft;
  const setLeague = (patch: Partial<LeagueConfig['league']>) => setCfg((c) => ({ ...c, league: { ...c.league, ...patch } }));
  const setDraft = (patch: Partial<LeagueConfig['draft']>) => setCfg((c) => ({ ...c, draft: { ...c.draft, ...patch } }));
  const setSlots = (slots: RosterSlots) => setLeague({ rosterSlots: slots });
  const setSlot = (s: SlotType, n: number) => setSlots({ ...L.rosterSlots, [s]: n });

  const individualIdp = (['DE', 'DT', 'CB', 'S'] as SlotType[]).some((s) => (L.rosterSlots[s] ?? 0) > 0);
  const groupedIdp = (['DL', 'DB'] as SlotType[]).some((s) => (L.rosterSlots[s] ?? 0) > 0);
  const idpOn = individualIdp || groupedIdp || (L.rosterSlots.LB ?? 0) > 0 || (L.rosterSlots.IDP_FLEX ?? 0) > 0;
  const idpMode: 'grouped' | 'individual' = individualIdp ? 'individual' : 'grouped';
  const size = rosterSize(L.rosterSlots);
  const positionsInUse = [...eligiblePositions(L.rosterSlots)];
  const colorPositions = [...OFFENSE_POSITIONS, ...IDP_POSITIONS].filter((p) => positionsInUse.includes(p));

  const setIdp = (on: boolean, mode: 'grouped' | 'individual' = idpMode) => {
    const next: RosterSlots = { ...L.rosterSlots };
    for (const s of [...IDP_GROUPED, ...IDP_INDIVIDUAL]) delete next[s];
    if (on) Object.assign(next, mode === 'grouped' ? { DL: 2, LB: 2, DB: 2, IDP_FLEX: 1 } : { DE: 2, DT: 1, LB: 2, CB: 2, S: 2 });
    setSlots(next);
  };

  const soundOptions = (
    <>
      {SOUNDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      {customSounds.map((m) => <option key={m.id} value={`media:${m.id}`}>Uploaded: {m.filename}</option>)}
    </>
  );

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="settings" value={JSON.stringify(cfg)} />

      <Section title="League">
        <Row label="League name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Row>
        <Row label="Number of teams" hint="Adding teams creates open teams; removing deletes the last teams without owners.">
          <select className="input" value={L.teamCount} onChange={(e) => setLeague({ teamCount: Number(e.target.value) })}>
            {Array.from({ length: 31 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Row>
        <Row label="Scoring" hint="Informational; included in exports.">
          <select className="input" value={L.scoring} onChange={(e) => setLeague({ scoring: e.target.value as typeof L.scoring })}>
            <option value="ppr">PPR</option><option value="half_ppr">Half PPR</option><option value="standard">Standard</option>
          </select>
        </Row>
        <Row label="League style">
          <select className="input" value={L.leagueStyle} onChange={(e) => {
            const style = e.target.value as typeof L.leagueStyle;
            setLeague({ leagueStyle: style, maxKeepers: style === 'keeper' ? Math.max(L.maxKeepers, 1) : L.maxKeepers });
            if (style === 'dynasty') setDraft({ playerPool: 'rookies', rounds: Math.min(D.rounds, 5) });
            else if (D.playerPool === 'rookies') setDraft({ playerPool: 'all', rounds: size });
          }}>
            <option value="redraft">Full redraft</option><option value="keeper">Keeper</option><option value="dynasty">Dynasty</option>
          </select>
        </Row>
        {L.leagueStyle === 'keeper' && (
          <Row label="Keepers per team" hint="Each keeper uses the team's pick in its assigned round (or its cost in an auction).">
            <Stepper value={L.maxKeepers} onChange={(n) => setLeague({ maxKeepers: n })} max={40} />
          </Row>
        )}
      </Section>

      <Section title="Roster" description={`${size} drafted spots per team. Start from a common format, then adjust any position.`}>
        <div className="mb-4 flex flex-wrap gap-2">
          {ROSTER_PRESETS.map((p) => (
            <button key={p.id} type="button" title={p.description} className="btn-secondary btn-sm" onClick={() => {
              setSlots({ ...p.slots });
              if (D.playerPool === 'all') setDraft({ rounds: rosterSize(p.slots) });
            }}>{p.label}</button>
          ))}
        </div>
        <div className="grid gap-x-8 sm:grid-cols-2">
          {OFFENSE_SLOTS.map((s) => (
            <Row key={s} label={SLOT_LABELS[s]}><Stepper value={L.rosterSlots[s] ?? 0} onChange={(n) => setSlot(s, n)} /></Row>
          ))}
          <Row label="Bench"><Stepper value={L.rosterSlots.BN ?? 0} onChange={(n) => setSlot('BN', n)} max={30} /></Row>
          <Row label="Injured reserve" hint="Not drafted."><Stepper value={L.irSlots} onChange={(n) => setLeague({ irSlots: n })} max={10} /></Row>
        </div>
        <div className="mt-4 rounded-xl border border-white/5 bg-ink-950/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-white">Individual defensive players (IDP)</div>
              <div className="text-xs text-slate-500">Draft defensive players instead of (or as well as) team defenses.</div>
            </div>
            <Toggle checked={idpOn} onChange={(v) => setIdp(v)} label="Use IDP" />
          </div>
          {idpOn && (
            <>
              <div className="mt-3 flex gap-2 text-sm">
                {(['grouped', 'individual'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setIdp(true, m)}
                    className={`btn-sm btn ${idpMode === m ? 'bg-brand-500 text-ink-950' : 'border border-white/10 text-slate-300'}`}>
                    {m === 'grouped' ? 'Grouped (DL / LB / DB)' : 'Each position (DE / DT / LB / CB / S)'}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid gap-x-8 sm:grid-cols-2">
                {(idpMode === 'grouped' ? IDP_GROUPED : IDP_INDIVIDUAL).map((s) => (
                  <Row key={s} label={SLOT_LABELS[s]}><Stepper value={L.rosterSlots[s] ?? 0} onChange={(n) => setSlot(s, n)} /></Row>
                ))}
              </div>
            </>
          )}
        </div>
      </Section>

      <Section title="Draft">
        <Row label="Draft type">
          <select className="input" value={D.type} onChange={(e) => setDraft({ type: e.target.value as typeof D.type })}>
            <option value="snake">Snake</option><option value="linear">Straight (linear)</option><option value="auction">Auction</option>
          </select>
        </Row>
        {D.type !== 'auction' && (
          <Row label="Rounds" hint={`Your roster has ${size} spots.`}>
            <div className="flex items-center gap-2">
              <Stepper value={D.rounds} onChange={(n) => setDraft({ rounds: n })} min={1} max={40} />
              {D.rounds !== size && <button type="button" className="btn-ghost btn-sm" onClick={() => setDraft({ rounds: size })}>Match roster</button>}
            </div>
          </Row>
        )}
        {D.type === 'snake' && (
          <Row label="Third-round reversal" hint="Round 3 runs in the same order as round 2, then snakes as usual.">
            <Toggle checked={D.thirdRoundReversal} onChange={(v) => setDraft({ thirdRoundReversal: v })} />
          </Row>
        )}
        <Row label="Player pool">
          <select className="input" value={D.playerPool} onChange={(e) => setDraft({ playerPool: e.target.value as typeof D.playerPool })}>
            <option value="all">All players</option><option value="rookies">Rookies only (dynasty)</option>
          </select>
        </Row>
        {D.type !== 'auction' ? (
          <Row label="Time per pick" hint="0 = no clock.">
            <div className="flex items-center gap-2">
              <input className="input w-28" type="number" min={0} max={86400} value={D.pickTimeSeconds} onChange={(e) => setDraft({ pickTimeSeconds: Math.max(0, Number(e.target.value)) })} />
              <span className="text-sm text-slate-400">seconds</span>
            </div>
          </Row>
        ) : (
          <>
            <Row label="Budget per team"><input className="input" type="number" min={1} value={D.auction.budget} onChange={(e) => setDraft({ auction: { ...D.auction, budget: Number(e.target.value) } })} /></Row>
            <Row label="Minimum bid"><input className="input" type="number" min={0} value={D.auction.minBid} onChange={(e) => setDraft({ auction: { ...D.auction, minBid: Number(e.target.value) } })} /></Row>
            <Row label="Time to nominate" hint="Seconds. 0 = no clock."><input className="input" type="number" min={0} value={D.auction.nominationSeconds} onChange={(e) => setDraft({ auction: { ...D.auction, nominationSeconds: Number(e.target.value) } })} /></Row>
            <Row label="Bid clock" hint="Seconds; resets after every bid."><input className="input" type="number" min={3} value={D.auction.bidSeconds} onChange={(e) => setDraft({ auction: { ...D.auction, bidSeconds: Number(e.target.value) } })} /></Row>
          </>
        )}
        <Row label="When time runs out" hint="Autopick uses rankings and roster needs.">
          <select className="input" value={D.autopickOnTimeout ? 'auto' : 'wait'} onChange={(e) => setDraft({ autopickOnTimeout: e.target.value === 'auto' })}>
            <option value="auto">Autopick for the team</option><option value="wait">Keep waiting</option>
          </select>
        </Row>
        <Row label="Who makes selections" hint="The commissioner can always pick or bid for any team.">
          <select className="input" value={D.selectionMode} onChange={(e) => setDraft({ selectionMode: e.target.value as typeof D.selectionMode })}>
            <option value="members">Each manager drafts for their team</option><option value="commissioner">Commissioner enters every pick</option>
          </select>
        </Row>
      </Section>

      <Section title="Sounds & announcements" description="Everyone can still mute sounds on their own device during the draft.">
        <Row label="When a pick is made">
          <div className="flex gap-2">
            <select className="input" value={D.audio.pickSound} onChange={(e) => setDraft({ audio: { ...D.audio, pickSound: e.target.value } })}>{soundOptions}</select>
            <button type="button" className="btn-secondary btn-sm" onClick={async () => { await unlockAudio(); playSound(D.audio.pickSound, D.audio.volume); }}>▶</button>
          </div>
        </Row>
        <Row label="When time is running out">
          <div className="flex gap-2">
            <select className="input" value={D.audio.warningSound} onChange={(e) => setDraft({ audio: { ...D.audio, warningSound: e.target.value } })}>{soundOptions}</select>
            <button type="button" className="btn-secondary btn-sm" onClick={async () => { await unlockAudio(); playSound(D.audio.warningSound, D.audio.volume); }}>▶</button>
          </div>
        </Row>
        <Row label="Warning threshold" hint="Seconds left when the warning plays.">
          <input className="input w-28" type="number" min={0} max={600} value={D.audio.warningThresholdSeconds} onChange={(e) => setDraft({ audio: { ...D.audio, warningThresholdSeconds: Number(e.target.value) } })} />
        </Row>
        <Row label="Announce who's on the clock" hint="Audio uses each team's uploaded clip (Teams & members), falling back to speech.">
          <select className="input" value={D.audio.announceMode} onChange={(e) => setDraft({ audio: { ...D.audio, announceMode: e.target.value as typeof D.audio.announceMode } })}>
            <option value="none">Don&apos;t announce</option><option value="tts">Say the team name</option><option value="audio">Play the team&apos;s audio clip</option>
          </select>
        </Row>
        <Row label="Read each pick aloud" hint={'Text-to-speech: "With the 5th pick, Team X selects …"'}>
          <div className="flex items-center gap-2">
            <Toggle checked={D.audio.announcePickTts} onChange={(v) => setDraft({ audio: { ...D.audio, announcePickTts: v } })} />
            <button type="button" className="btn-ghost btn-sm" onClick={async () => { await unlockAudio(); speak('With the first pick, Team One selects Patrick Mahomes, quarterback, Kansas City.', D.audio.volume); }}>Preview</button>
          </div>
        </Row>
        <Row label="Volume">
          <input type="range" min={0} max={1} step={0.05} value={D.audio.volume} onChange={(e) => setDraft({ audio: { ...D.audio, volume: Number(e.target.value) } })} className="w-full accent-emerald-500" />
        </Row>
      </Section>

      <Section title="Position colors" description="Used on the draft board and player lists.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {colorPositions.map((p: Position) => (
            <label key={p} className="flex items-center gap-2 rounded-lg border border-white/5 bg-ink-950/40 p-2">
              <input type="color" value={D.positionColors[p] ?? DEFAULT_POSITION_COLORS[p]} className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent"
                onChange={(e) => setDraft({ positionColors: { ...D.positionColors, [p]: e.target.value } })} />
              <span className="text-sm font-semibold text-white">{p === 'DST' ? 'D/ST' : p}</span>
            </label>
          ))}
        </div>
        <button type="button" className="btn-ghost btn-sm mt-3" onClick={() => setDraft({ positionColors: { ...DEFAULT_POSITION_COLORS } })}>Reset to defaults</button>
      </Section>

      <div className="sticky bottom-4 z-10 flex items-center gap-3 rounded-2xl border border-white/10 bg-ink-850/95 p-3 shadow-2xl backdrop-blur">
        <SubmitButton>Save settings</SubmitButton>
        {state.error && <p role="alert" className="text-sm text-red-300">{state.error}</p>}
        {state.ok && <p role="status" className="text-sm text-emerald-300">{state.ok}</p>}
      </div>
    </form>
  );
}
