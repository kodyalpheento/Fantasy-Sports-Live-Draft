import { describe, expect, it } from 'vitest';
import {
  AUTO_DELAY_MS, applyCommand, buildSlots, chooseAutopick, createDraft, currentSlot, maxBid, nextWakeAt, normalizePosition,
  onTheClockTeam, tick, type Actor, type DraftConfig, type DraftState, type EngineContext, type PoolPlayer,
} from './index';

const commish: Actor = { userId: 'u-commish', role: 'commissioner', teamIds: ['t1'] };
const member = (teamId: string): Actor => ({ userId: `u-${teamId}`, role: 'member', teamIds: [teamId] });

function mkPlayer(id: string, pos: string, rank: number | null, extra: Partial<PoolPlayer> = {}): PoolPlayer {
  const n = normalizePosition(pos)!;
  return { id, name: `${pos} ${id}`, position: n.position, positions: n.positions, team: 'KC', rank, rookie: false, ...extra };
}

function pool(): Map<string, PoolPlayer> {
  const players: PoolPlayer[] = [];
  let rank = 1;
  // Interleave positions roughly like a real ADP list.
  const pattern = ['RB', 'WR', 'RB', 'WR', 'WR', 'RB', 'QB', 'TE', 'WR', 'RB'];
  for (let i = 0; i < 300; i++) {
    const pos = pattern[i % pattern.length];
    players.push(mkPlayer(`p${i}`, pos, rank++));
  }
  for (let i = 0; i < 32; i++) players.push(mkPlayer(`k${i}`, 'K', 200 + i));
  for (let i = 0; i < 32; i++) players.push(mkPlayer(`d${i}`, 'DST', 180 + i));
  return new Map(players.map((p) => [p.id, p]));
}

function config(overrides: Partial<DraftConfig> = {}): DraftConfig {
  return {
    draftId: 'd1',
    type: 'snake',
    rounds: 3,
    teams: [{ id: 't1', name: 'One' }, { id: 't2', name: 'Two' }, { id: 't3', name: 'Three' }],
    rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BN: 6 },
    pickTimeSeconds: 60,
    autopickOnTimeout: true,
    thirdRoundReversal: false,
    selectionMode: 'members',
    auction: { budget: 200, minBid: 1, nominationSeconds: 30, bidSeconds: 10 },
    keepers: [],
    ...overrides,
  };
}

function run(state: DraftState, actor: Actor, cmd: Parameters<typeof applyCommand>[1], ctx: EngineContext) {
  const r = applyCommand(state, cmd, actor, ctx);
  if (r.error) throw new Error(r.error);
  return r;
}

describe('pick order', () => {
  it('snakes and reverses every other round', () => {
    const order = buildSlots(config()).map((s) => s.teamId);
    expect(order).toEqual(['t1', 't2', 't3', 't3', 't2', 't1', 't1', 't2', 't3']);
  });

  it('linear keeps the same order every round', () => {
    const order = buildSlots(config({ type: 'linear' })).map((s) => s.teamId);
    expect(order).toEqual(['t1', 't2', 't3', 't1', 't2', 't3', 't1', 't2', 't3']);
  });

  it('supports third round reversal', () => {
    const order = buildSlots(config({ rounds: 4, thirdRoundReversal: true })).map((s) => s.teamId);
    expect(order).toEqual(['t1', 't2', 't3', 't3', 't2', 't1', 't3', 't2', 't1', 't1', 't2', 't3']);
  });
});

describe('snake draft', () => {
  const players = pool();

  it('runs picks, enforces turn order and permissions, completes', () => {
    let now = 1_000;
    let s = createDraft(config({ rounds: 1 }));
    expect(applyCommand(s, { type: 'start' }, member('t1'), { now, players }).error).toMatch(/commissioner/);
    s = run(s, commish, { type: 'start' }, { now, players }).state;
    expect(s.status).toBe('running');
    expect(onTheClockTeam(s)).toBe('t1');
    expect(s.clock.deadline).toBe(now + 60_000);

    expect(applyCommand(s, { type: 'pick', playerId: 'p0' }, member('t2'), { now, players }).error).toMatch(/cannot pick/);
    s = run(s, member('t1'), { type: 'pick', playerId: 'p0' }, { now, players }).state;
    expect(applyCommand(s, { type: 'pick', playerId: 'p0' }, member('t2'), { now, players }).error).toMatch(/already been drafted/);
    s = run(s, member('t2'), { type: 'pick', playerId: 'p1' }, { now: ++now, players }).state;
    const r = run(s, commish, { type: 'pick', playerId: 'p2' }, { now: ++now, players });
    expect(r.state.status).toBe('completed');
    expect(r.events.map((e) => e.kind)).toContain('completed');
    expect(r.state.picks.map((p) => p.teamId)).toEqual(['t1', 't2', 't3']);
  });

  it('commissioner-only mode blocks members', () => {
    let s = createDraft(config({ selectionMode: 'commissioner' }));
    s = run(s, commish, { type: 'start' }, { now: 0, players }).state;
    expect(applyCommand(s, { type: 'pick', playerId: 'p0' }, member('t1'), { now: 0, players }).error).toMatch(/cannot pick/);
    expect(applyCommand(s, { type: 'pick', playerId: 'p0' }, commish, { now: 0, players }).error).toBeUndefined();
  });

  it('pauses and resumes with the remaining time', () => {
    let s = createDraft(config());
    s = run(s, commish, { type: 'start' }, { now: 0, players }).state;
    s = run(s, commish, { type: 'pause' }, { now: 20_000, players }).state;
    expect(s.status).toBe('paused');
    expect(s.clock.pausedRemainingMs).toBe(40_000);
    expect(nextWakeAt(s)).toBeNull();
    expect(applyCommand(s, { type: 'pick', playerId: 'p0' }, commish, { now: 21_000, players }).error).toMatch(/paused/);
    s = run(s, commish, { type: 'resume' }, { now: 100_000, players }).state;
    expect(s.clock.deadline).toBe(140_000);
  });

  it('autopicks when the clock runs out', () => {
    let s = createDraft(config());
    s = run(s, commish, { type: 'start' }, { now: 0, players }).state;
    expect(tick(s, { now: 59_999, players }).events).toHaveLength(0);
    const r = tick(s, { now: 60_000, players });
    expect(r.state.picks).toHaveLength(1);
    expect(r.state.picks[0]).toMatchObject({ teamId: 't1', playerId: 'p0', isAuto: true });
    expect(currentSlot(r.state)?.teamId).toBe('t2');
  });

  it('waits in overtime when autopick-on-timeout is off', () => {
    let s = createDraft(config({ autopickOnTimeout: false }));
    s = run(s, commish, { type: 'start' }, { now: 0, players }).state;
    const r = tick(s, { now: 61_000, players });
    expect(r.state.picks).toHaveLength(0);
    expect(r.state.clock.deadline).toBeNull();
  });

  it('teams on autopick pick after a short delay', () => {
    let s = createDraft(config());
    s = run(s, commish, { type: 'setAutopick', teamId: 't1', enabled: true }, { now: 0, players }).state;
    s = run(s, commish, { type: 'start' }, { now: 0, players }).state;
    expect(s.autoActionAt).toBe(AUTO_DELAY_MS);
    const r = tick(s, { now: AUTO_DELAY_MS, players });
    expect(r.state.picks[0]?.teamId).toBe('t1');
  });

  it('members can only toggle autopick for their own team', () => {
    const s = createDraft(config());
    expect(applyCommand(s, { type: 'setAutopick', teamId: 't2', enabled: true }, member('t1'), { now: 0, players }).error).toBeTruthy();
    expect(applyCommand(s, { type: 'setAutopick', teamId: 't1', enabled: true }, member('t1'), { now: 0, players }).error).toBeUndefined();
  });

  it('undo removes the last pick and puts that team back on the clock', () => {
    let s = createDraft(config());
    s = run(s, commish, { type: 'start' }, { now: 0, players }).state;
    s = run(s, commish, { type: 'pick', playerId: 'p0' }, { now: 1, players }).state;
    s = run(s, commish, { type: 'pick', playerId: 'p1' }, { now: 2, players }).state;
    s = run(s, commish, { type: 'undo' }, { now: 3, players }).state;
    expect(s.picks.map((p) => p.playerId)).toEqual(['p0']);
    expect(onTheClockTeam(s)).toBe('t2');
  });

  it('places keepers in their round and skips those picks', () => {
    const s = createDraft(config({ keepers: [{ teamId: 't3', playerId: 'p5', round: 1 }, { teamId: 't1', playerId: 'p9', round: null }] }));
    expect(s.picks).toEqual([expect.objectContaining({ overall: 3, teamId: 't3', playerId: 'p5', isKeeper: true })]);
    expect(s.preRostered).toEqual([{ teamId: 't1', playerId: 'p9' }]);
    let st = run(s, commish, { type: 'start' }, { now: 0, players }).state;
    st = run(st, commish, { type: 'pick', playerId: 'p0' }, { now: 1, players }).state;
    st = run(st, commish, { type: 'pick', playerId: 'p1' }, { now: 2, players }).state;
    // Pick 3 belongs to t3's keeper, so t3 is next with pick 4.
    expect(currentSlot(st)).toMatchObject({ overall: 4, teamId: 't3' });
    expect(applyCommand(st, { type: 'pick', playerId: 'p9' }, commish, { now: 3, players }).error).toMatch(/already/);
  });
});

describe('autopick intelligence', () => {
  it('fills needs: after two RBs it prefers other open starters over a higher ranked RB', () => {
    const players = new Map([
      mkPlayer('rb1', 'RB', 1), mkPlayer('rb2', 'RB', 2), mkPlayer('rb3', 'RB', 3),
      mkPlayer('wr1', 'WR', 4), mkPlayer('qb1', 'QB', 30), mkPlayer('k1', 'K', 5),
    ].map((p) => [p.id, p]));
    const cfg = config({ teams: [{ id: 't1', name: 'One' }], rounds: 16, rosterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 0, K: 1, DST: 1, BN: 6 } });
    let s = createDraft(cfg);
    s = run(s, commish, { type: 'start' }, { now: 0, players }).state;
    s = run(s, commish, { type: 'pick', playerId: 'rb1' }, { now: 1, players }).state;
    s = run(s, commish, { type: 'pick', playerId: 'rb2' }, { now: 2, players }).state;
    expect(chooseAutopick(s, 't1', players)?.id).toBe('wr1');
  });

  it('does not take a kicker or defense early', () => {
    const players = new Map([mkPlayer('k1', 'K', 1), mkPlayer('d1', 'DST', 2), mkPlayer('wr1', 'WR', 50)].map((p) => [p.id, p]));
    const s = createDraft(config({ teams: [{ id: 't1', name: 'One' }], rounds: 16 }));
    expect(chooseAutopick(s, 't1', players)?.id).toBe('wr1');
  });

  it('caps quarterbacks in one-QB leagues', () => {
    const players = new Map([mkPlayer('qb1', 'QB', 1), mkPlayer('qb2', 'QB', 2), mkPlayer('qb3', 'QB', 3), mkPlayer('wr1', 'WR', 90)].map((p) => [p.id, p]));
    let s = createDraft(config({ teams: [{ id: 't1', name: 'One' }], rounds: 16 }));
    s = run(s, commish, { type: 'start' }, { now: 0, players }).state;
    s = run(s, commish, { type: 'pick', playerId: 'qb1' }, { now: 1, players }).state;
    s = run(s, commish, { type: 'pick', playerId: 'qb2' }, { now: 2, players }).state;
    expect(chooseAutopick(s, 't1', players)?.id).toBe('wr1');
  });

  it('uses the team queue first', () => {
    const players = pool();
    let s = createDraft(config());
    s = run(s, member('t1'), { type: 'setQueue', teamId: 't1', playerIds: ['p40', 'p41'] }, { now: 0, players }).state;
    expect(chooseAutopick(s, 't1', players)?.id).toBe('p40');
  });

  it('a full autopick draft fills every starting slot', () => {
    const players = pool();
    const teams = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, name: `T${i}` }));
    const cfg = config({ teams, rounds: 15, pickTimeSeconds: 0 });
    let s = createDraft(cfg);
    for (const t of teams) s = run(s, commish, { type: 'setAutopick', teamId: t.id, enabled: true }, { now: 0, players }).state;
    s = run(s, commish, { type: 'start' }, { now: 0, players }).state;
    let now = 0;
    while (s.status === 'running') {
      now = nextWakeAt(s)!;
      s = tick(s, { now, players }).state;
    }
    expect(s.picks).toHaveLength(150);
    for (const t of teams) {
      const roster = s.picks.filter((p) => p.teamId === t.id).map((p) => players.get(p.playerId)!);
      const count = (pos: string) => roster.filter((p) => p.position === pos).length;
      expect(count('QB')).toBeGreaterThanOrEqual(1);
      expect(count('QB')).toBeLessThanOrEqual(2);
      expect(count('RB')).toBeGreaterThanOrEqual(2);
      expect(count('WR')).toBeGreaterThanOrEqual(2);
      expect(count('TE')).toBeGreaterThanOrEqual(1);
      expect(count('K')).toBe(1);
      expect(count('DST')).toBe(1);
    }
  });
});

describe('auction draft', () => {
  const players = pool();
  const cfg = () => config({
    type: 'auction',
    rosterSlots: { QB: 1, RB: 1, WR: 1 },
    auction: { budget: 10, minBid: 1, nominationSeconds: 30, bidSeconds: 10 },
  });

  it('nominates, bids, awards and rotates the nominator', () => {
    let s = createDraft(cfg());
    s = run(s, commish, { type: 'start' }, { now: 0, players }).state;
    expect(onTheClockTeam(s)).toBe('t1');
    s = run(s, member('t1'), { type: 'nominate', playerId: 'p0', amount: 2 }, { now: 1, players }).state;
    expect(s.auction?.phase).toBe('bidding');
    expect(applyCommand(s, { type: 'bid', amount: 2 }, member('t2'), { now: 2, players }).error).toMatch(/more than/);
    s = run(s, member('t2'), { type: 'bid', amount: 5 }, { now: 2, players }).state;
    expect(s.clock.deadline).toBe(10_002);
    // t2 has 3 spots and $10: max bid is 10 - 2*1 = 8.
    expect(maxBid(s, 't2')).toBe(8);
    expect(applyCommand(s, { type: 'bid', amount: 9 }, member('t3'), { now: 3, players }).error).toMatch(/Maximum/);
    const r = tick(s, { now: 10_002, players });
    expect(r.state.picks[0]).toMatchObject({ teamId: 't2', playerId: 'p0', price: 5 });
    expect(r.state.auction?.budgets.t2).toBe(5);
    expect(onTheClockTeam(r.state)).toBe('t2');
  });

  it('auto-nominates on timeout and completes when rosters fill', () => {
    let s = createDraft(cfg());
    for (const t of ['t1', 't2', 't3']) s = run(s, commish, { type: 'setAutopick', teamId: t, enabled: true }, { now: 0, players }).state;
    s = run(s, commish, { type: 'start' }, { now: 0, players }).state;
    let guard = 0;
    while (s.status === 'running' && guard++ < 1000) s = tick(s, { now: nextWakeAt(s)!, players }).state;
    expect(s.status).toBe('completed');
    expect(s.picks).toHaveLength(9);
    for (const t of ['t1', 't2', 't3']) {
      expect(s.auction!.budgets[t]).toBeGreaterThanOrEqual(0);
      expect(s.picks.filter((p) => p.teamId === t)).toHaveLength(3);
    }
  });

  it('deducts keeper costs from budgets', () => {
    const s = createDraft({ ...cfg(), keepers: [{ teamId: 't1', playerId: 'p0', cost: 4 }] });
    expect(s.auction?.budgets.t1).toBe(6);
    expect(s.picks[0]).toMatchObject({ isKeeper: true, price: 4 });
  });

  it('undo refunds the winning bid', () => {
    let s = createDraft(cfg());
    s = run(s, commish, { type: 'start' }, { now: 0, players }).state;
    s = run(s, commish, { type: 'nominate', playerId: 'p0', amount: 3 }, { now: 1, players }).state;
    s = tick(s, { now: 20_000, players }).state;
    expect(s.auction?.budgets.t1).toBe(7);
    s = run(s, commish, { type: 'undo' }, { now: 20_001, players }).state;
    expect(s.auction?.budgets.t1).toBe(10);
    expect(s.picks).toHaveLength(0);
    expect(onTheClockTeam(s)).toBe('t1');
  });
});
