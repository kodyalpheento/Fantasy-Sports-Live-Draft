import { eq } from 'drizzle-orm';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { SubmitButton } from '@/components/action-form';
import { getDb } from '@/db';
import { invites, leagues } from '@/db/schema';
import { getSession, pendingAuthStep } from '@/lib/auth';
import { sha256Hex } from '@/lib/crypto';
import { acceptInviteAction } from '../../leagues/actions';

export const metadata = { title: 'League invite' };

function Shell({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-md px-4 py-20"><div className="card p-7 text-center">{children}</div></main>;
}

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const [row] = await getDb().select({ invite: invites, league: leagues }).from(invites)
    .innerJoin(leagues, eq(leagues.id, invites.leagueId)).where(eq(invites.tokenHash, await sha256Hex(token))).limit(1);
  const s = await getSession();
  const here = `/invite/${token}`;

  if (!row || row.invite.acceptedAt || row.invite.expiresAt < new Date() || error === 'expired') {
    return <Shell><h1 className="text-xl font-bold text-white">This invite has expired</h1><p className="mt-2 text-slate-400">Ask your commissioner to send a new one.</p></Shell>;
  }
  const { invite, league } = row;
  if (!s) {
    return (
      <Shell>
        <h1 className="text-xl font-bold text-white">You&apos;re invited to {league.name}</h1>
        <p className="mt-2 text-slate-400">Create an account (or sign in) with <b className="text-slate-200">{invite.email}</b> to join.</p>
        <div className="mt-6 flex justify-center gap-2">
          <Link className="btn-primary" href={`/signup?next=${encodeURIComponent(here)}&email=${encodeURIComponent(invite.email)}`}>Create account</Link>
          <Link className="btn-secondary" href={`/login?next=${encodeURIComponent(here)}&email=${encodeURIComponent(invite.email)}`}>Sign in</Link>
        </div>
      </Shell>
    );
  }
  const step = pendingAuthStep(s);
  if (step) {
    return <Shell><h1 className="text-xl font-bold text-white">Almost there</h1><p className="mt-2 text-slate-400">Finish securing your account first.</p><Link className="btn-primary mt-6" href={`${step}?next=${encodeURIComponent(here)}`}>Continue</Link></Shell>;
  }
  if (error === 'email' || s.user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return <Shell><h1 className="text-xl font-bold text-white">Wrong account</h1><p className="mt-2 text-slate-400">This invite is for <b className="text-slate-200">{invite.email}</b>, but you&apos;re signed in as {s.user.email}.</p></Shell>;
  }
  return (
    <Shell>
      <h1 className="text-xl font-bold text-white">Join {league.name}?</h1>
      <p className="mt-2 text-slate-400">You&apos;ll be able to join its drafts and see its history.</p>
      <form action={acceptInviteAction.bind(null, token)} className="mt-6"><SubmitButton>Join league</SubmitButton></form>
    </Shell>
  );
}
