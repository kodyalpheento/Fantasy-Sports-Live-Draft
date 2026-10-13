import { describe, expect, it } from 'vitest';
import {
  exportDraft, mapTeams, matchExternalPlayers, normalizeLeagueConfig, parseCsv, parseRosterCsv,
  signRealtimeToken, verifyRealtimeToken, type ExportPick,
} from './index';

describe('csv', () => {
  it('parses quoted fields', () => {
    expect(parseCsv('a,"b, c","d ""q"""\n1,2,3\n')).toEqual([['a', 'b, c', 'd "q"'], ['1', '2', '3']]);
  });

  it('exports draft results with formula injection guarded', () => {
    const picks: ExportPick[] = [{
      overall: 1, round: 1, pickInRound: 1, teamName: '=HYPERLINK("x")', playerId: '4046', playerName: 'Some Player',
      position: 'QB', nflTeam: 'KC', price: null, isKeeper: false, isAuto: false, espnId: '3139477', yahooId: '30123',
    }];
    const out = exportDraft('espn', { leagueName: 'My League', season: 2026, draftType: 'snake' }, picks);
    expect(out.filename).toBe('my-league-2026-draft-espn.csv');
    expect(out.body).toContain('3139477');
    expect(out.body).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('roster import', () => {
  const players = [
    { id: '1', fullName: 'Patrick Mahomes', position: 'QB', team: 'KC', espnId: '3139477', yahooId: null },
    { id: '2', fullName: 'Marvin Harrison Jr.', position: 'WR', team: 'ARI', espnId: null, yahooId: null },
    { id: 'CHI', fullName: 'Chicago Bears', position: 'DST', team: 'CHI', espnId: null, yahooId: null },
  ];

  it('parses flexible CSV headers and matches by id, name and defense nickname', () => {
    const rosters = parseRosterCsv('Team,Player,Pos,Round\nAlpha,Marvin Harrison,WR,3\nAlpha,Bears D/ST,DEF,\nBeta,Nobody Here,RB,\n');
    expect(rosters.map((r) => r.teamName)).toEqual(['Alpha', 'Beta']);
    expect(rosters[0].players[0].round).toBe(3);
    const all = rosters.flatMap((r) => r.players);
    const { matched, unmatched } = matchExternalPlayers([...all, { name: 'x', espnId: '3139477' }], players);
    expect(matched.map((m) => m.playerId)).toEqual(['2', 'CHI', '1']);
    expect(unmatched.map((u) => u.name)).toEqual(['Nobody Here']);
  });

  it('maps teams by name then order', () => {
    const ext = [{ teamName: 'Beta', players: [] }, { teamName: 'Zeta', players: [] }];
    const m = mapTeams(ext, [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'beta' }]);
    expect(m.get(ext[0])?.id).toBe('b');
    expect(m.get(ext[1])?.id).toBe('a');
  });
});

describe('settings', () => {
  it('fills defaults for partial settings', () => {
    const cfg = normalizeLeagueConfig({ league: { teamCount: 10 }, draft: { type: 'auction' } });
    expect(cfg.league.teamCount).toBe(10);
    expect(cfg.draft.type).toBe('auction');
    expect(cfg.draft.auction.budget).toBe(200);
  });
});

describe('realtime tokens', () => {
  it('signs and verifies, rejecting tampering and expiry', async () => {
    const payload = { draftId: 'd', userId: 'u', name: 'U', role: 'member' as const, teamIds: ['t'], exp: Date.now() + 1000 };
    const token = await signRealtimeToken(payload, 'secret');
    expect(await verifyRealtimeToken(token, 'secret')).toMatchObject({ draftId: 'd' });
    expect(await verifyRealtimeToken(token, 'other')).toBeNull();
    expect(await verifyRealtimeToken(token.replace(/^./, 'x'), 'secret')).toBeNull();
    expect(await verifyRealtimeToken(token, 'secret', Date.now() + 5000)).toBeNull();
  });
});
