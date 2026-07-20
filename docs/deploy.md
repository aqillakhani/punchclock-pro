# PunchClock Pro — Deploy & Operations Runbook

Single-tenant production deploy. Stack chosen in `docs/plans/2026-05-21-production-deploy.md`:

| Concern | Service | Notes |
|---|---|---|
| API (Express + Socket.io) | **Fly.io** | Persistent machine, region `ord`. `packages/api/Dockerfile` + `fly.toml`. |
| Web (Next.js) | **Vercel** | Root directory `packages/web`. Native Git integration. |
| Postgres | **Neon** | Pooled connection; daily PITR on free tier. |
| Redis | **none** | Not deployed. Only needed to fan Socket.io broadcasts across instances once the API runs on more than one machine — the adapter is already wired and activates when `REDIS_URL` is set. `/health` reports `redis: "disabled"` until then. |
| Documents | **Cloudflare R2** | S3-compatible. Optional until document upload is enabled. |
| Email | **Resend** | `EMAIL_PROVIDER=resend`; until then emails are logged, not sent. |
| Errors | **Sentry** | Optional; no-op until a DSN is set. |
| DNS | **Cloudflare** | Points the domains at Fly + Vercel. |
| CI | **GitHub Actions** | `.github/workflows/ci.yml` — typecheck, lint, test, web build. |

Estimated cost at low volume: **$5–25/mo** (mostly free tiers).

---

## 1. One-time account setup

Create accounts and capture the secret each one produces. Drop them in a password manager.

- [ ] **Domain** (e.g. via Cloudflare Registrar). Decide on `punchclock.<domain>.com` (web) and `api.punchclock.<domain>.com` (API).
- [ ] **Fly.io** — `flyctl auth signup`; run `flyctl auth token` for CI. → `FLY_API_TOKEN`
- [ ] **Vercel** — sign up, install the GitHub app on this repo.
- [ ] **Neon** — create a project. Copy the **pooled** connection string (ends with `-pooler`, append `?sslmode=require`). → `DATABASE_URL`
- [ ] **Redis — not required.** The API runs single-instance without it (Socket.io uses its in-memory adapter; `/health` reports `redis: "disabled"`). Only when you scale past one API machine do you need one — see [Scaling past one API instance](#scaling-past-one-api-instance).
- [ ] **Cloudflare R2** — create a bucket + an S3 API token. → `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (only needed once document upload is enabled)
- [ ] **Resend** — verify your sending domain, create an API key. → `RESEND_API_KEY`, set `EMAIL_FROM="PunchClock Pro <noreply@punchclock.<domain>.com>"`
- [ ] **Sentry** (optional) — create a project (Node) + a second (Next.js). → `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`
- [ ] Generate the JWT secret: `openssl rand -base64 64` → `JWT_SECRET`

The full variable reference lives in [`.env.example`](../.env.example).

---

## 2. First deploy

### 2a. Provision the database

```bash
# Run migrations against prod (from your machine, pointed at Neon).
DATABASE_URL="<neon-pooled-url>" pnpm --filter @punchclock/api db:migrate
# Do NOT run db:seed (that's demo data). Production seeding is step 2e.
```

### 2b. Deploy the API to Fly

The Docker build context must be the **monorepo root** (it needs the workspace
lockfile + the shared package), so always deploy from the repo root:

```bash
flyctl launch --no-deploy --config packages/api/fly.toml --copy-config   # first time only
flyctl secrets set --config packages/api/fly.toml \
  DATABASE_URL="<neon-pooled-url>" \
  JWT_SECRET="<openssl-output>" \
  CORS_ALLOWED_ORIGINS="https://punchclock.<domain>.com" \
  WEB_APP_URL="https://punchclock.<domain>.com" \
  RESEND_API_KEY="<resend-key>" \
  EMAIL_FROM="PunchClock Pro <noreply@punchclock.<domain>.com>" \
  SENTRY_DSN="<sentry-node-dsn>"
flyctl deploy . --remote-only \
  --config packages/api/fly.toml \
  --dockerfile packages/api/Dockerfile \
  --env APP_VERSION="$(git rev-parse --short HEAD)"
```

> The API refuses to boot in production with the dev JWT secret, `DATABASE_SSL`
> off, or a localhost CORS origin — that's the env hardening doing its job. Fix
> the offending secret and redeploy.

Verify: `curl https://<fly-app>.fly.dev/health` → `{ "status": "ok", "version": "<sha>", "db": "up", "redis": "disabled" }`.

`redis: "disabled"` is the expected result on a single machine and does **not**
mean something failed — see [Scaling past one API instance](#scaling-past-one-api-instance).
It reads `"up"` only once you have set `REDIS_URL`.

### 2c. Deploy the web app to Vercel

- New Project → import this repo → **Root Directory: `packages/web`**.
- Environment variables:
  - `NEXT_PUBLIC_API_BASE_URL=https://api.punchclock.<domain>.com`
  - `NEXT_PUBLIC_WS_URL=wss://api.punchclock.<domain>.com`
  - `NEXT_PUBLIC_SENTRY_DSN=<sentry-web-dsn>` (optional)
- Deploy. Vercel auto-builds Next.js (no Dockerfile needed).

### 2d. DNS + HTTPS (Cloudflare)

- `api.punchclock.<domain>.com` → Fly (`flyctl certs add api.punchclock.<domain>.com`, then add the shown CNAME/A records).
- `punchclock.<domain>.com` → Vercel (add the domain in Vercel, create the CNAME).
- Both issue certificates automatically. Confirm TLS is valid in a browser.

### 2e. Bootstrap the owner + seed the store

1. Visit `https://punchclock.<domain>.com/signup` and create the first owner. (This route 403s once any org exists.)
2. Seed the store geofence + default caps (idempotent; refuses if >1 user exists):

```bash
SEED_GEOFENCE_NAME="Main Store" \
SEED_GEOFENCE_LAT="29.76" SEED_GEOFENCE_LNG="-95.37" SEED_GEOFENCE_RADIUS_M="150" \
DATABASE_URL="<neon-pooled-url>" pnpm --filter @punchclock/api db:seed:prod
```

3. Sign in → the dashboard renders. Invite a worker (leave the password blank to email them a setup link).

---

## 3. Shipping a change

1. Open a PR. CI (`.github/workflows/ci.yml`) runs typecheck + lint + tests + web build and gates the merge.
2. Merge to `main`.
3. **Web** auto-deploys via Vercel's Git integration.
4. **API**: run the `flyctl deploy …` command from step 2b (or wire it into a GitHub Action with `FLY_API_TOKEN`). Always pass `--env APP_VERSION="$(git rev-parse --short HEAD)"` so `/health` reports the deployed SHA.

After editing `packages/shared`, remember `pnpm --filter @punchclock/shared build` before typecheck/lint (CI does this automatically via turbo).

---

## 4. Rolling back

- **API (Fly):** `flyctl releases --config packages/api/fly.toml` to list versions, then `flyctl deploy --image <previous-image-ref> --config packages/api/fly.toml` (or `flyctl releases rollback` on recent flyctl).
- **Web (Vercel):** Project → Deployments → pick the last-good deployment → **Promote to Production**. Instant, no rebuild.

---

## 5. Restoring from backup (Neon)

1. Neon console → your project → **Branches** → create a branch from a point in time (or use **Restore**).
2. Copy the new branch's pooled connection string.
3. `flyctl secrets set DATABASE_URL="<branch-url>" --config packages/api/fly.toml` (triggers a redeploy), and update `DATABASE_URL` in Vercel if the web ever reads it.
4. Verify, then optionally promote the branch to primary.

Drill this once before launch: snapshot → mutate a row → restore → confirm it reverted.

---

## 6. Adding an environment variable

1. Add it to the Zod schema in `packages/api/src/config/env.ts` (and document it in `.env.example`).
2. **API:** `flyctl secrets set NEW_VAR=value --config packages/api/fly.toml` (redeploys automatically).
3. **Web:** add it in the Vercel dashboard (use the `NEXT_PUBLIC_` prefix for anything the browser needs) and redeploy.

---

## 7. Scheduled jobs

- **Audit-log pruning:** `pnpm --filter @punchclock/api db:prune-audit` deletes audit rows past each org's `audit_logs_retention_days` (default 365). Schedule it daily — e.g. a Fly scheduled machine:
  `flyctl machine run . --schedule daily --config packages/api/fly.toml --command "pnpm --filter @punchclock/api db:prune-audit"` (or an external cron hitting a one-off machine).

---

## 8. Monitoring

- **Uptime:** point BetterStack/UptimeRobot at `https://api.punchclock.<domain>.com/health/live` and the web root, 1-minute interval, alerting **you** (not the owner).
- **Errors:** once `SENTRY_DSN` is set, 5xx responses and unhandled rejections flow to Sentry. (Web client-side capture + source-map upload via `withSentryConfig` is a follow-up — see `packages/web/src/instrumentation.ts`.)
- **Logs:** `flyctl logs --config packages/api/fly.toml`.
- **`/health` semantics:** `ok` = healthy; `degraded` = database up but a *configured* Redis is unreachable; `error` = database down (503, the only status that should page you). `redis: "disabled"` is normal on a single instance and does **not** degrade the service.

---

## Scaling past one API instance

The API runs on one Fly machine by design (`min_machines_running = 1`). At one
machine Socket.io's in-memory adapter already reaches every connected client, so
**no Redis is required** and `/health` reports `redis: "disabled"`.

The moment there are two machines that stops being true: a broadcast emitted on
machine A never reaches clients connected to machine B. Before scaling up:

```bash
# 1. Provision Redis reachable on Fly's private network. Either a managed
#    provider (rediss:// URL) or an internal-only Fly app, mirroring
#    deploy/db/fly.toml — no public IP, no [http_service].
# 2. Point the API at it. A localhost URL is rejected at boot in production.
flyctl secrets set --config packages/api/fly.toml REDIS_URL="rediss://<host>:6379"

# 3. Confirm the adapter installed, then scale.
flyctl logs --config packages/api/fly.toml | grep "Redis adapter"
#   -> "Socket.io Redis adapter installed — broadcasts fan out across instances"
curl -s https://api.punchclock.<domain>.com/health   # redis should now be "up"
flyctl scale count 2 --config packages/api/fly.toml
```

Rate limiting stays in-memory per instance even then — a deliberate trade
documented in `packages/api/src/middleware/rate-limit.ts`. Per-instance buckets
mean the effective limit multiplies by the machine count; if that becomes too
loose, add the `rate-limit-redis` package and pass a store built on a client
from `config/redis.ts` into `createRateLimiter`.

---

## Deferred / follow-ups

- Document upload to R2 (set the `S3_*` vars) — wire the presigned-URL flow.
- Sentry web client config + source-map upload (`withSentryConfig`).
- GitHub Action for automatic Fly deploys on `main` (needs `FLY_API_TOKEN`).
- Redis-backed rate limiting, if per-instance buckets become too loose after scaling out. (The Socket.io Redis adapter is already wired — see [Scaling past one API instance](#scaling-past-one-api-instance).)
