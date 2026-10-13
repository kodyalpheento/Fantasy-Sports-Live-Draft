'use client';

/** Draft-room sounds: built-in tones synthesized with Web Audio (no files to host), uploaded clips, and speech. */

let ctx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

/** Browsers only allow sound after a user gesture; call this from a click handler. */
export async function unlockAudio(): Promise<boolean> {
  const c = audioContext();
  if (!c) return false;
  if (c.state === 'suspended') await c.resume().catch(() => undefined);
  if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
  return c.state === 'running';
}

export function audioUnlocked(): boolean {
  return ctx?.state === 'running';
}

type Tone = { freq: number; start: number; dur: number; type?: OscillatorType; gain?: number; slideTo?: number };

const BUILTIN: Record<string, Tone[]> = {
  chime: [
    { freq: 880, start: 0, dur: 0.35, type: 'sine' },
    { freq: 1318.5, start: 0.12, dur: 0.6, type: 'sine' },
  ],
  horn: [
    { freq: 196, start: 0, dur: 0.7, type: 'sawtooth', gain: 0.35 },
    { freq: 247, start: 0, dur: 0.7, type: 'sawtooth', gain: 0.3 },
    { freq: 294, start: 0, dur: 0.7, type: 'sawtooth', gain: 0.25 },
  ],
  whistle: [
    { freq: 2200, start: 0, dur: 0.25, type: 'sine', slideTo: 2600 },
    { freq: 2600, start: 0.3, dur: 0.5, type: 'sine', slideTo: 2300 },
  ],
  beep: [
    { freq: 880, start: 0, dur: 0.12, type: 'square', gain: 0.4 },
    { freq: 880, start: 0.2, dur: 0.12, type: 'square', gain: 0.4 },
  ],
  buzzer: [{ freq: 140, start: 0, dur: 0.6, type: 'sawtooth', gain: 0.6 }],
};

function playTones(tones: Tone[], volume: number) {
  const c = audioContext();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  for (const t of tones) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = t.type ?? 'sine';
    osc.frequency.setValueAtTime(t.freq, now + t.start);
    if (t.slideTo) osc.frequency.linearRampToValueAtTime(t.slideTo, now + t.start + t.dur);
    const peak = Math.max(0.0001, volume * (t.gain ?? 0.6) * 0.5);
    gain.gain.setValueAtTime(0.0001, now + t.start);
    gain.gain.exponentialRampToValueAtTime(peak, now + t.start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + t.start + t.dur);
    osc.connect(gain).connect(c.destination);
    osc.start(now + t.start);
    osc.stop(now + t.start + t.dur + 0.05);
  }
}

export function playClip(url: string, volume: number): Promise<void> {
  return new Promise((resolve) => {
    const a = new Audio(url);
    a.volume = Math.min(1, Math.max(0, volume));
    a.onended = () => resolve();
    a.onerror = () => resolve();
    a.play().catch(() => resolve());
  });
}

/** Play a sound reference from the draft settings: a built-in name or `media:<id>`. */
export function playSound(ref: string, volume: number) {
  if (!ref || ref === 'none') return;
  if (ref.startsWith('media:')) {
    void playClip(`/api/media/${ref.slice(6)}`, volume);
    return;
  }
  const tones = BUILTIN[ref];
  if (tones) playTones(tones, volume);
}

/** Speak text aloud; resolves when finished (or after a timeout if the browser never reports the end). */
export function speak(text: string, volume: number): Promise<void> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.volume = Math.min(1, Math.max(0, volume));
    u.rate = 1;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((v) => /en[-_]US/i.test(v.lang) && /google|natural|samantha|aria|jenny/i.test(v.name)) ?? voices.find((v) => /^en/i.test(v.lang));
    if (voice) u.voice = voice;
    const done = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, 4000 + text.length * 90);
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  });
}

/** Runs announcements one after another so speech and clips never talk over each other. */
export function createAnnouncer() {
  let chain: Promise<void> = Promise.resolve();
  return (task: () => Promise<void> | void) => {
    chain = chain.then(task).catch(() => undefined);
  };
}

export function stopSpeech() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}
