/**
 * Loads a sample player pool for local development (the real list syncs daily from Sleeper).
 * Names are generated — they are placeholders, not real NFL players. Run `Sync now` in Admin to load real data.
 */
import 'dotenv/config';
import { normalizePosition } from '@fsd/core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { players } from '../src/db/schema';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client);

const TEAMS: [string, string, string][] = [
  ['ARI', 'Arizona', 'Cardinals'], ['ATL', 'Atlanta', 'Falcons'], ['BAL', 'Baltimore', 'Ravens'], ['BUF', 'Buffalo', 'Bills'],
  ['CAR', 'Carolina', 'Panthers'], ['CHI', 'Chicago', 'Bears'], ['CIN', 'Cincinnati', 'Bengals'], ['CLE', 'Cleveland', 'Browns'],
  ['DAL', 'Dallas', 'Cowboys'], ['DEN', 'Denver', 'Broncos'], ['DET', 'Detroit', 'Lions'], ['GB', 'Green Bay', 'Packers'],
  ['HOU', 'Houston', 'Texans'], ['IND', 'Indianapolis', 'Colts'], ['JAX', 'Jacksonville', 'Jaguars'], ['KC', 'Kansas City', 'Chiefs'],
  ['LV', 'Las Vegas', 'Raiders'], ['LAC', 'Los Angeles', 'Chargers'], ['LAR', 'Los Angeles', 'Rams'], ['MIA', 'Miami', 'Dolphins'],
  ['MIN', 'Minnesota', 'Vikings'], ['NE', 'New England', 'Patriots'], ['NO', 'New Orleans', 'Saints'], ['NYG', 'New York', 'Giants'],
  ['NYJ', 'New York', 'Jets'], ['PHI', 'Philadelphia', 'Eagles'], ['PIT', 'Pittsburgh', 'Steelers'], ['SF', 'San Francisco', '49ers'],
  ['SEA', 'Seattle', 'Seahawks'], ['TB', 'Tampa Bay', 'Buccaneers'], ['TEN', 'Tennessee', 'Titans'], ['WAS', 'Washington', 'Commanders'],
];
const FIRST = ['Jalen', 'Marcus', 'Tyler', 'Devin', 'Chris', 'Jordan', 'Malik', 'Brandon', 'Cameron', 'Darius', 'Ethan', 'Isaiah', 'Trey', 'Xavier',
  'Andre', 'Caleb', 'Derrick', 'Elijah', 'Garrett', 'Hunter', 'Jamal', 'Keenan', 'Lamar', 'Mason', 'Nate', 'Omar', 'Preston', 'Quinn', 'Reggie', 'Shane'];
const LAST = ['Walker', 'Brooks', 'Coleman', 'Hayes', 'Jenkins', 'Porter', 'Reed', 'Simmons', 'Turner', 'Ward', 'Bishop', 'Carver', 'Dawson', 'Ellis',
  'Fletcher', 'Griffin', 'Holloway', 'Irving', 'Jefferson', 'Kirkland', 'Lockett', 'Mercer', 'Nolan', 'Owens', 'Pruitt', 'Ramsey', 'Sutton', 'Tolbert', 'Vance', 'Whitfield'];

// Roughly how many of each position appear in the top of a fantasy ranking list.
const MIX: [string, number][] = [['RB', 70], ['WR', 90], ['QB', 36], ['TE', 32], ['K', 32], ['DE', 24], ['DT', 16], ['LB', 30], ['CB', 24], ['S', 20]];

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

const rows: (typeof players.$inferInsert)[] = [];
let n = 0;
const used = new Set<string>();
for (const [pos, count] of MIX) {
  for (let i = 0; i < count; i++) {
    let name: string;
    do name = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`; while (used.has(name));
    used.add(name);
    const norm = normalizePosition(pos)!;
    const team = TEAMS[Math.floor(rand() * TEAMS.length)][0];
    const rookie = rand() < 0.12;
    // Interleave skill positions by drawing a noisy rank; kickers and IDP rank later.
    const base = pos === 'K' ? 170 : ['DE', 'DT', 'LB', 'CB', 'S'].includes(pos) ? 200 : pos === 'QB' ? 40 : pos === 'TE' ? 50 : 1;
    const spread = pos === 'K' ? 40 : base === 200 ? 150 : 220;
    const id = `sample-${++n}`;
    rows.push({
      id, fullName: name, firstName: name.split(' ')[0], lastName: name.split(' ')[1], position: norm.position, positions: norm.positions,
      team, rank: Math.round(base + (i / count) * spread + rand() * 12), age: 21 + Math.floor(rand() * 12), yearsExp: rookie ? 0 : 1 + Math.floor(rand() * 10),
      rookie, status: 'Active', headshotUrl: null, active: true,
    });
  }
}
for (const [abbr, city, nick] of TEAMS) {
  rows.push({
    id: abbr, fullName: `${city} ${nick}`, firstName: city, lastName: nick, position: 'DST', positions: ['DST'], team: abbr,
    rank: 150 + Math.floor(rand() * 60), rookie: false, status: 'Active',
    headshotUrl: `https://sleepercdn.com/images/team_logos/nfl/${abbr.toLowerCase()}.png`, active: true,
  });
}

const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(players);
if (count > 0 && !process.argv.includes('--force')) {
  console.log(`players table already has ${count} rows; skipping (pass --force to add samples anyway).`);
} else {
  for (let i = 0; i < rows.length; i += 500) await db.insert(players).values(rows.slice(i, i + 500)).onConflictDoNothing();
  console.log(`Inserted ${rows.length} sample players.`);
}
await client.end();
