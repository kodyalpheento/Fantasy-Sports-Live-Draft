#!/usr/bin/env node
/**
 * One-step local setup for Live Draft (Windows, macOS, Linux).
 *
 *   node scripts/setup-local.mjs            # set everything up
 *   node scripts/setup-local.mjs --start    # ...and start the app
 *   node scripts/setup-local.mjs --no-docker  # use your own Postgres (set DATABASE_URL in apps/web/.env first)
 *
 * Steps: check Node/Docker → npm install → create secrets (.env, .dev.vars) → start Postgres →
 * run migrations → load real NFL players from Sleeper (falls back to sample players if Sleeper is unreachable).
 */
import { spawnSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const useDocker = !args.has('--no-docker');

const c = { green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };
const step = (s) => console.log(`\n${c.bold('▶ ' + s)}`);
const ok = (s) => console.log(c.green(`  ✓ ${s}`));
const warn = (s) => console.log(c.yellow(`  ! ${s}`));
const fail = (s) => { console.error(c.red(`\n✗ ${s}`)); process.exit(1); };

function run(cmd, { cwd = root, quiet = false, allowFail = false } = {}) {
  const r = spawnSync(cmd, { cwd, shell: true, stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (r.status !== 0 && !allowFail) fail(`Command failed: ${cmd}${quiet ? `\n${r.stderr || r.stdout}` : ''}`);
  return r;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Prerequisites
step('Checking prerequisites');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 20 || (major === 20 && minor < 9)) fail(`Node.js 20.9 or newer is required (you have ${process.versions.node}). Get it from https://nodejs.org`);
ok(`Node.js ${process.versions.node}`);
if (useDocker) {
  if (run('docker compose version', { quiet: true, allowFail: true }).status !== 0) {
    fail('Docker is not available. Install Docker Desktop (https://www.docker.com/products/docker-desktop) and start it,\n  or use your own PostgreSQL: set DATABASE_URL in apps/web/.env and re-run with --no-docker.');
  }
  if (run('docker info', { quiet: true, allowFail: true }).status !== 0) fail('Docker is installed but not running. Start Docker Desktop and try again.');
  ok('Docker is running');
}

// 2. Dependencies
step('Installing dependencies (npm install)');
run('npm install --no-audit --no-fund');
ok('Dependencies installed');

// 3. Secrets
step('Creating local configuration');
const envPath = join(root, 'apps/web/.env');
if (!existsSync(envPath)) {
  copyFileSync(join(root, 'apps/web/.env.example'), envPath);
  ok('Created apps/web/.env');
}
let env = readFileSync(envPath, 'utf8');
const getVar = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim() ?? '';
const setVar = (k, v) => { env = new RegExp(`^${k}=`, 'm').test(env) ? env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : `${env.trimEnd()}\n${k}=${v}\n`; };
if (!getVar('ENCRYPTION_KEY')) { setVar('ENCRYPTION_KEY', randomBytes(32).toString('base64')); ok('Generated ENCRYPTION_KEY'); }
if (!getVar('REALTIME_SECRET') || getVar('REALTIME_SECRET').startsWith('change-me')) { setVar('REALTIME_SECRET', randomBytes(24).toString('hex')); ok('Generated REALTIME_SECRET'); }
writeFileSync(envPath, env);
writeFileSync(join(root, 'apps/realtime/.dev.vars'), `REALTIME_SECRET=${getVar('REALTIME_SECRET')}\n`);
ok('Wrote apps/realtime/.dev.vars (matching secret)');

// 4. Database
if (useDocker) {
  step('Starting PostgreSQL (Docker)');
  run('docker compose up -d postgres');
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    ready = run('docker compose exec -T postgres pg_isready -U draft -d livedraft', { quiet: true, allowFail: true }).status === 0;
    if (!ready) await sleep(1000);
  }
  if (!ready) fail('PostgreSQL did not start. See: docker compose logs postgres');
  ok('PostgreSQL is ready on localhost:5432');
}
step('Creating database tables');
run('npm run db:migrate');
ok('Database is up to date');

// 5. Player data
step('Loading NFL players from Sleeper');
const check = run('npm run players:sync -- --check', { quiet: true, allowFail: true });
if (check.status === 0) {
  console.log(`  ${(check.stdout.match(/✓.*$/m) ?? [''])[0]}`);
  const sync = run('npm run players:sync -- --remove-samples', { allowFail: true });
  if (sync.status === 0) ok('Real player data loaded');
  else warn('Sync failed; loading sample players instead.');
  if (sync.status !== 0) run('npm run db:seed');
} else {
  warn('Could not reach api.sleeper.app from this computer.');
  console.log(`  ${(check.stderr || check.stdout).split('\n').filter((l) => l.includes('✗')).join('\n  ')}`);
  console.log('  Loading made-up sample players so you can still try the app. To load real players later:');
  console.log('    1. Open https://api.sleeper.app/v1/players/nfl in a browser and save it as players.json');
  console.log('    2. Run: npm run players:sync -- --file players.json --remove-samples');
  run('npm run db:seed');
}

// 6. Done
console.log(`\n${c.green(c.bold('Setup complete!'))}`);
console.log(`  Start the app:  ${c.bold('npm run dev')}`);
console.log('  Then open:      http://localhost:3000  (the first account you create becomes the admin)');
console.log('  Emails (invites, password resets) print in this terminal until RESEND_API_KEY is set in apps/web/.env.');

if (args.has('--start')) {
  console.log('\nStarting… (Ctrl+C to stop)\n');
  spawn('npm run dev', { cwd: root, shell: true, stdio: 'inherit' });
}
