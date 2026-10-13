import Link from 'next/link';
import { getSession, pendingAuthStep } from '@/lib/auth';
import { SPORTS } from '@/lib/leagues';

const FEATURES = [
  ['Snake, linear & auction', 'Every common draft type, plus third-round reversal, keepers and rookie-only dynasty drafts.'],
  ['A board people love', 'Big, colorful, live-updating draft board for the TV — with headshots, pick sounds and spoken announcements.'],
  ['Smart autopick', 'Can\'t make it? Autopick drafts by rankings and roster need, so nobody ends up with four quarterbacks.'],
  ['Import & export', 'Bring rosters in from Sleeper, ESPN or a CSV, and export results with each platform\'s player IDs.'],
] as const;

export default async function HomePage() {
  const s = await getSession();
  const signedIn = s && !pendingAuthStep(s);

  if (!signedIn) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-16">
        <section className="mx-auto max-w-3xl text-center">
          <p className="badge mb-4 bg-brand-500/15 text-brand-400">Fantasy football · live drafts</p>
          <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-6xl">Draft night, done right.</h1>
          <p className="mt-5 text-lg text-slate-300">
            Run your league&apos;s live draft from any browser. Everyone joins from their phone, the board goes up on the big screen,
            and the commissioner stays in control.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link href="/signup" className="btn-primary px-6 py-3 text-base">Create an account</Link>
            <Link href="/login" className="btn-secondary px-6 py-3 text-base">Sign in</Link>
          </div>
        </section>
        <section className="mt-16 grid gap-4 sm:grid-cols-2">
          {FEATURES.map(([title, body]) => (
            <div key={title} className="card">
              <h2 className="font-semibold text-white">{title}</h2>
              <p className="mt-1 text-sm text-slate-400">{body}</p>
            </div>
          ))}
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <h1 className="text-3xl font-bold text-white">What are you drafting?</h1>
      <p className="mt-1 text-slate-400">Pick a sport to see your leagues.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SPORTS.map((sport) =>
          sport.available ? (
            <Link key={sport.id} href={`/sports/${sport.id}`} className="card group transition hover:-translate-y-0.5 hover:border-brand-500/40">
              <div className="text-5xl">{sport.emoji}</div>
              <div className="mt-4 text-lg font-semibold text-white group-hover:text-brand-400">{sport.name}</div>
              <div className="text-sm text-slate-400">{sport.league}</div>
            </Link>
          ) : (
            <div key={sport.id} className="card opacity-50">
              <div className="text-5xl grayscale">{sport.emoji}</div>
              <div className="mt-4 text-lg font-semibold text-white">{sport.name}</div>
              <div className="text-sm text-slate-400">Coming soon</div>
            </div>
          ),
        )}
      </div>
    </main>
  );
}
