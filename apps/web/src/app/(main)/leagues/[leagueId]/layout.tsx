import type { ReactNode } from 'react';
import { Badge } from '@/components/ui';
import { requireLeague } from '@/lib/leagues';
import { LeagueTabs } from './tabs';

export default async function LeagueLayout({ children, params }: { children: ReactNode; params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await params;
  const { league, config, isCommissioner } = await requireLeague(leagueId);
  const tabs = [
    { href: `/leagues/${leagueId}`, label: 'Overview' },
    { href: `/leagues/${leagueId}/members`, label: 'Teams & members' },
    { href: `/leagues/${leagueId}/keepers`, label: config.league.leagueStyle === 'keeper' ? 'Keepers' : 'Rosters' },
    { href: `/leagues/${leagueId}/history`, label: 'Past drafts' },
    ...(isCommissioner ? [{ href: `/leagues/${leagueId}/settings`, label: 'Settings' }] : []),
  ];
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">{league.name}</h1>
        <div className="flex flex-wrap gap-1">
          <Badge color="blue">{config.draft.type}</Badge>
          <Badge>{config.league.leagueStyle}</Badge>
          <Badge>{config.league.teamCount} teams</Badge>
          {isCommissioner && <Badge color="violet">Commissioner</Badge>}
        </div>
      </div>
      <LeagueTabs tabs={tabs} />
      <div className="mt-6">{children}</div>
    </main>
  );
}
