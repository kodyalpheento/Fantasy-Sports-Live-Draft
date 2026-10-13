/**
 * Load the real NFL player list from Sleeper into the database.
 *
 *   npm run players:sync                         # download from Sleeper and import
 *   npm run players:sync -- --check              # only test that Sleeper is reachable
 *   npm run players:sync -- --file players.json  # import a file you downloaded yourself
 *   npm run players:sync -- --remove-samples     # also delete the made-up sample players from `db:seed`
 *
 * If your network blocks the download, open https://api.sleeper.app/v1/players/nfl in a browser,
 * save the page as players.json, and use --file.
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { like, notInArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { appState, players } from '../src/db/schema';
import { SLEEPER_PLAYERS_URL, fromSleeper, type SleeperPlayer } from '../src/lib/sleeper';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : undefined;

async function download(): Promise<Record<string, SleeperPlayer>> {
  console.log(`Downloading ${SLEEPER_PLAYERS_URL} (about 5 MB)…`);
  let res: Response;
  try {
    res = await fetch(SLEEPER_PLAYERS_URL, { headers: { accept: 'application/json' } });
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    throw new Error(
      `Could not reach api.sleeper.app (${cause?.code ?? cause?.message ?? (err as Error).message}).\n` +
      '  • Check your internet connection, VPN, firewall or corporate proxy.\n' +
      '  • Behind a proxy? Set HTTPS_PROXY and run with: node --use-env-proxy (Node 24+), or use --file.\n' +
      `  • Or open ${SLEEPER_PLAYERS_URL} in a browser, save it as players.json, and run with --file players.json`,
    );
  }
  if (!res.ok) throw new Error(`Sleeper responded HTTP ${res.status}. Try again later or use --file.`);
  return (await res.json()) as Record<string, SleeperPlayer>;
}

async function main() {
  if (flag('--check')) {
    const res = await fetch('https://api.sleeper.app/v1/state/nfl').catch((err) => {
      console.error(`✗ Cannot reach api.sleeper.app: ${(err as { cause?: { code?: string } }).cause?.code ?? (err as Error).message}`);
      process.exit(1);
    });
    const state = (await res.json()) as { season?: string; week?: number };
    console.log(`✓ Sleeper is reachable (HTTP ${res.status}). Current NFL season ${state.season}, week ${state.week}.`);
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Copy apps/web/.env.example to apps/web/.env first.');

  const data = fileArg ? (JSON.parse(await readFile(fileArg, 'utf8')) as Record<string, SleeperPlayer>) : await download();
  const rows = Object.entries(data).map(([id, p]) => fromSleeper(id, p)).filter((r): r is NonNullable<typeof r> => !!r);
  if (rows.length < 500) throw new Error(`Only ${rows.length} usable players found; that doesn't look like Sleeper's player list.`);

  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client);
  try {
    for (let i = 0; i < rows.length; i += 500) {
      await db.insert(players).values(rows.slice(i, i + 500)).onConflictDoUpdate({
        target: players.id,
        set: {
          fullName: sql`excluded.full_name`, firstName: sql`excluded.first_name`, lastName: sql`excluded.last_name`,
          position: sql`excluded.position`, positions: sql`excluded.positions`, team: sql`excluded.team`,
          rank: sql`excluded.rank`, age: sql`excluded.age`, yearsExp: sql`excluded.years_exp`, rookie: sql`excluded.rookie`,
          status: sql`excluded.status`, injuryStatus: sql`excluded.injury_status`, espnId: sql`excluded.espn_id`,
          yahooId: sql`excluded.yahoo_id`, headshotUrl: sql`excluded.headshot_url`, active: sql`true`, updatedAt: sql`now()`,
        },
      });
      process.stdout.write(`\r  imported ${Math.min(i + 500, rows.length)} / ${rows.length}`);
    }
    process.stdout.write('\n');
    await db.update(players).set({ active: false }).where(notInArray(players.id, rows.map((r) => r.id)));
    if (flag('--remove-samples')) {
      const removed = await db.delete(players).where(like(players.id, 'sample-%')).returning({ id: players.id });
      console.log(`  removed ${removed.length} sample players`);
    }
    const status = { at: new Date().toISOString(), ok: true, count: rows.length };
    await db.insert(appState).values({ key: 'player_sync', value: status })
      .onConflictDoUpdate({ target: appState.key, set: { value: status, updatedAt: new Date() } });
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(players).where(sql`${players.active} and ${players.rank} is not null`);
    console.log(`✓ ${rows.length} players imported (${n} ranked and active).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
