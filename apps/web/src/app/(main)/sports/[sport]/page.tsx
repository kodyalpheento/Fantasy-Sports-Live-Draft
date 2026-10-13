import { and, eq, inArray } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Empty, PageHeader, formatDate } from '@/components/ui';
import { getDb } from '@/db';
import { drafts, leagueMembers, leagues, teams } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { SPORTS } from '@/lib/leagues';
import { normalizeLeagueConfig } from '@fsd/core';

export default async function SportPage({ params }: { params: Promise<{ sport: string }> }) {
  const { sport: sportId } = await params;
  const sport = SPORTS.find((s) => s.id === sportId);
  if (!sport) notFound();
  const user = await requireUser();
  const db = getDb();

  const memberships = await db.select({ league: leagues, role: leagueMembers.role })
    .from(leagueMembers).innerJoin(leagues, eq(leagues.id, leagueMembers.leagueId))
    .where(and(eq(leagueMembers.userId, user.id), eq(leagues.sport, sport.id)))
    .orderBy(leagues.name);
  const ids = memberships.map((m) => m.league.id);
  const [draftRows, myTeams] = ids.length
    ? await Promise.all([
        db.select().from(drafts).where(and(inArray(drafts.leagueId, ids), eq(drafts.isMock, false))),
        db.select().from(teams).where(and(inArray(teams.leagueId, ids), eq(teams.ownerUserId, user.id))),
      ])
    : [[], []];

  const now = Date.now();
  const rows = memberships.map(({ league, role }) => {
    const ld = draftRows.filter((d) => d.leagueId === league.id);
    const live = ld.find((d) => d.status === 'in_progress' || d.status === 'paused');
    const next = ld.filter((d) => d.status === 'scheduled')
      .sort((a, b) => (a.scheduledAt?.getTime() ?? Infinity) - (b.scheduledAt?.getTime() ?? Infinity))[0];
    const last = ld.filter((d) => d.status === 'completed').sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0))[0];
    const cfg = normalizeLeagueConfig(league.settings);
    return { league, role, live, next, last, cfg, team: myTeams.find((t) => t.leagueId === league.id) };
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader
        title={`${sport.emoji} ${sport.name} leagues`}
        subtitle="Every league you run or play in."
        back={{ href: '/', label: 'All sports' }}
        actions={<Link href="/leagues/new" className="btn-primary">+ New league</Link>}
      />
      {rows.length === 0 ? (
        <Empty>
          You&apos;re not in any leagues yet. <Link href="/leagues/new" className="text-brand-400 hover:underline">Create one</Link>, or ask your commissioner for an invite.
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map(({ league, role, live, next, last, cfg, team }) => (
            <Link key={league.id} href={`/leagues/${league.id}`} className="card block transition hover:border-brand-500/40">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">{league.name}</h2>
                  <p className="text-sm text-slate-400">{team ? team.name : 'No team'} · {cfg.league.teamCount} teams</p>
                </div>
                <div className="flex flex-wrap justify-end gap-1">
                  {live && <Badge color="red">● Live now</Badge>}
                  {role === 'commissioner' && <Badge color="violet">Commissioner</Badge>}
                  <Badge color="blue">{cfg.draft.type}</Badge>
                  <Badge>{cfg.league.leagueStyle}</Badge>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-ink-950/50 p-3">
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Next draft</dt>
                  <dd className="mt-0.5 font-medium text-slate-100">
                    {next ? (next.scheduledAt ? formatDate(next.scheduledAt) : `${next.season} · date TBD`) : '—'}
                    {next?.scheduledAt && next.scheduledAt.getTime() < now && <span className="ml-1 text-amber-300">(ready)</span>}
                  </dd>
                </div>
                <div className="rounded-lg bg-ink-950/50 p-3">
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Last draft</dt>
                  <dd className="mt-0.5 font-medium text-slate-100">{last ? formatDate(last.completedAt, { dateStyle: 'medium' }) : '—'}</dd>
                </div>
              </dl>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
