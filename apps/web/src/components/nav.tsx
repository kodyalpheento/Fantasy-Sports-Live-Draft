import Link from 'next/link';
import { getSession, pendingAuthStep } from '@/lib/auth';
import { logoutAction } from '@/app/(main)/(auth)/actions';

export async function Nav() {
  const session = await getSession();
  const ready = session && !pendingAuthStep(session);
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight text-white">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-ink-950">LD</span>
          <span>Live Draft</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {ready ? (
            <>
              <Link href="/sports/nfl" className="btn-ghost hidden sm:inline-flex">My leagues</Link>
              {session.user.isAdmin && <Link href="/admin" className="btn-ghost">Admin</Link>}
              <Link href="/account" className="btn-ghost">{session.user.displayName}</Link>
              <form action={logoutAction}><button className="btn-ghost">Sign out</button></form>
            </>
          ) : session ? (
            <form action={logoutAction}><button className="btn-ghost">Sign out</button></form>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">Sign in</Link>
              <Link href="/signup" className="btn-primary">Create account</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
