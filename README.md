# Live Draft — live fantasy sports drafting

A web app for running live fantasy drafts, starting with NFL football. Commissioners set up leagues, managers join from any device, and the draft board goes up on the big screen.

## What's in it

| Requirement (from the application outline) | Where it lives |
|---|---|
| Snake, straight (linear) and auction drafts, plus third-round reversal | `packages/core/src/engine.ts` |
| Redraft, keeper (configurable number of keepers) and dynasty (rookies-only draft) leagues | League settings, the **Keepers / Rosters** tab |
| Custom roster formats: every position, bench, IR, IDP grouped (DL/LB/DB) or by position (DE/DT/LB/CB/S), presets based on ESPN, Sleeper and Yahoo defaults | `packages/core/src/settings.ts`, league **Settings** |
| Pick clock, a pick sound, a "time is running out" sound with an adjustable threshold, custom uploaded sounds | **Settings → Sounds & announcements** |
| Announce who's on the clock by team name (text-to-speech) or a team's uploaded audio clip; read each pick aloud | Same settings, plus team audio under **Teams & members** |
| Custom colors per position | **Settings → Position colors** |
| Import rosters from Sleeper (API), ESPN (API, private leagues with cookies) and Yahoo/any (CSV) | **Keepers / Rosters → Import** |
| Export results for ESPN, Sleeper and Yahoo (each with that platform's player IDs), generic CSV and JSON | **Past drafts → Export** |
| Daily automatic NFL player updates (position, team, headshot, rankings) from Sleeper | `apps/web/src/lib/players.ts`, cron |
| Multiple leagues per commissioner | **My leagues** |
| Autopick that drafts by rankings *and* roster need (e.g. after two RBs it goes for WR/TE/QB), uses each team's queue first, and auto-bids in auctions | `packages/core/src/autopick.ts` |
| Remote board viewing (a full-screen TV board, shareable read-only link) | `/board/[draftId]` |
| Managers make their own picks/bids, or the commissioner enters everything | **Settings → Who makes selections** |
| Pause / resume, undo, mute all sounds (per device) | Draft room toolbar |
| Mock drafts so the commissioner can test settings | League overview → **Start a mock draft** |
| Email invites; email is the username; password + 2FA set up at sign-up | **Teams & members**, `/signup`, `/setup-2fa` |
| League list: sport picker → leagues with next and last draft dates → past seasons' results | `/`, `/sports/nfl`, **Past drafts** |
| No hardcoded secrets; `.env` ignored before the first commit; 2FA enforced for everyone (configurable for private deployments, never for admins); email password reset | `.gitignore`, `.env.example`, `apps/web/src/lib/auth.ts` |
| Backups: manual + scheduled (time, days, number kept), download, restore, copy to Backblaze B2 / any S3 / SharePoint-OneDrive / a local, synced or NAS folder (self-hosted) | **Admin → Backups** |

## Architecture

```
packages/core     Shared TypeScript: draft engine, autopick, roster rules, settings schema, import/export, tokens
apps/realtime     Cloudflare Worker + one Durable Object per draft (WebSockets, pick clock via alarms, autopick)
apps/web          Next.js (React + TypeScript): UI, server actions/API, PostgreSQL via Drizzle; deploys to Cloudflare with OpenNext
```

- **Front end:** Next.js 16 / React 19, Tailwind CSS.
- **Back end:** Next.js server actions and route handlers (Node.js / TypeScript).
- **Real-time layer:** Cloudflare Durable Objects. Each draft room is the single source of truth while live. It checks every pick/bid with the shared engine, runs the clock, broadcasts to all browsers, and pushes picks back to the web app (`/api/internal/drafts/:id/sync`) so they're saved in Postgres.
- **Database:** PostgreSQL (Hyperdrive on Cloudflare). Schema is in `apps/web/src/db/schema.ts`, migrations in `apps/web/drizzle/`.
- **Scheduled jobs:** the realtime worker's cron trigger calls `/api/internal/cron` every 15 minutes, which syncs players (daily) and runs due backups.

Browsers get a short-lived HMAC-signed token from `/api/drafts/:id/token` and use it to open the WebSocket. The web app and worker authenticate to each other with the shared `REALTIME_SECRET`.

## Quick start (one command)

Install [Node.js 20.9+](https://nodejs.org) and [Docker Desktop](https://www.docker.com/products/docker-desktop) (start it), then from the project folder:

- **Windows:** double-click `setup.bat` (or run `setup.bat --start`)
- **macOS / Linux:** `./setup.sh --start`

The setup script installs dependencies, generates secrets into `apps/web/.env` and `apps/realtime/.dev.vars`, starts PostgreSQL in Docker, creates the tables, and loads the real NFL player list from Sleeper. Then `npm run dev` and open http://localhost:3000. Already have PostgreSQL? Put its URL in `apps/web/.env` as `DATABASE_URL` and run `node scripts/setup-local.mjs --no-docker`.

### Player data from Sleeper

```bash
npm run players:sync -- --check                 # is api.sleeper.app reachable?
npm run players:sync -- --remove-samples        # download real players, drop the sample ones
npm run players:sync -- --file players.json     # import a file you saved yourself
```

If a firewall, VPN or proxy blocks the download, open https://api.sleeper.app/v1/players/nfl in a browser, save the page as `players.json`, and use `--file`. Once deployed, the app also re-syncs daily by itself.

## Local development

Requirements: Node 20.9+, Docker (or any PostgreSQL 14+).

```bash
npm install
npm run db:up                                   # Postgres in Docker
cp apps/web/.env.example apps/web/.env          # then fill in ENCRYPTION_KEY and REALTIME_SECRET
cp apps/realtime/.dev.vars.example apps/realtime/.dev.vars   # same REALTIME_SECRET
npm run db:migrate
npm run db:seed                                 # sample players with made-up names, for offline dev
npm run dev                                     # web on :3000, realtime worker on :8787
```

The first account you create becomes the site admin. Without `RESEND_API_KEY`, invite and password-reset emails print to the web server console. Use **Admin → Sync now** to load the real NFL player list from Sleeper.

Checks:

```bash
npm test          # engine, import/export and token tests
npm run typecheck
npm run build
```

## Deploying to Cloudflare

1. **Database:** create a PostgreSQL database (Neon, Supabase, RDS, etc.), run `npm run db:migrate` against it, then
   `npx wrangler hyperdrive create livedraft --connection-string="postgres://…"` and put the ID in `apps/web/wrangler.jsonc`.
2. **Backups bucket:** `npx wrangler r2 bucket create livedraft-backups`.
3. **Secrets:**
   - realtime: `cd apps/realtime && npx wrangler secret put REALTIME_SECRET`
   - web: `cd apps/web && npx wrangler secret put REALTIME_SECRET` (same value), `ENCRYPTION_KEY`, `RESEND_API_KEY`, optional `ADMIN_EMAILS`.
4. Set `APP_URL` / `REALTIME_URL` / `EMAIL_FROM` in `apps/web/wrangler.jsonc` and `APP_URL` / `ALLOWED_ORIGINS` in `apps/realtime/wrangler.jsonc`. Uncomment the `APP` service binding in the realtime config once the web worker exists.
5. `npm run deploy` (realtime first, then web). Later updates are the same command: Cloudflare Workers deploys replace the running version.

## Known limitations / next steps

- **Platform exports:** ESPN, Sleeper and Yahoo don't offer an API for uploading draft results. Exports are pick-by-pick files with each platform's player IDs, ready for its "offline draft" entry screen. Entering them there is still manual.
- **Yahoo import** needs OAuth app approval, so Yahoo rosters come in by CSV for now.
- **Rankings** come from Sleeper's search rank. Custom per-league rankings uploads would make autopick smarter.
- **Subscriptions** (the planned $25/year plan) aren't built yet. There's no payment gating.
- **Backups on Cloudflare** are stored in R2. "Local folder / NAS" copies only work when self-hosting on Node, because a cloud worker can't reach your network. Use Download, B2/S3 or SharePoint instead.
- Only football is enabled. The sport picker, data model (`leagues.sport`) and engine are sport-agnostic, but positions and player sync are NFL-specific today.
