# Production deploy — managed cloud, single tenant

**Date:** 2026-05-21
**Predecessor:** v2 plan (`docs/plans/2026-05-13-mvp-v2.md`) — feature-complete.
**Scope:** ship the existing codebase to a real domain with HTTPS, backups, monitoring, and email — enough that the c-store owner can actually run their team off it without me hand-holding.
**Estimated:** 5–7 days of focused work (excluding mobile v2 catch-up, which is +1.5 days).

> Order matters: P0 unlocks everything; P1 is operational hygiene that protects you in week one; P2 is what makes the product usable for non-technical users.

---

## 0. Decisions to lock in before any code

| Decision | Recommended | Why | Alternative |
|---|---|---|---|
| **API compute** | Fly.io (machine VM, region = ord) | Persistent container, websockets out of the box, $5/mo for a 256 MB shared-cpu-1x, deploys in 60s via `fly deploy` | AWS Lightsail Container ($10/mo), ECS Fargate (heavier setup) |
| **Web hosting** | Vercel | Best Next.js DX, free Hobby tier covers single tenant easily, preview deploys per PR | Fly Static, AWS Amplify |
| **Postgres** | Neon (free tier → $19/mo Launch) | Managed, daily PITR, branching for staging, generous free | Supabase, Railway, AWS RDS ($30+/mo) |
| **Redis** | Upstash (free → $0.20/100k commands) | Serverless-friendly, REST endpoint as fallback for cold-start scenarios | Fly's bundled Redis, AWS ElastiCache |
| **Object storage** (documents) | Cloudflare R2 | Zero egress fees, S3-compatible API, $0.015/GB stored | AWS S3, Backblaze B2 |
| **Email** | Resend ($20/mo for 50k) | Modern, simple, React-friendly templates | Postmark, AWS SES (cheaper but more setup) |
| **Error tracking** | Sentry (free tier covers single tenant) | Industry standard, captures backend + frontend + sourcemaps | — |
| **DNS / domain** | Cloudflare | Free, fast, generous rate limits | Owner's registrar of choice |
| **CI** | GitHub Actions | Already on GitHub, free for public/private with low minutes | — |

**Total monthly cost estimate (low-volume single tenant): $5–25/mo.** Free tiers cover most of it.

> If you want AWS specifically: ECS Fargate + RDS + ElastiCache + SES + S3, ~$50–150/mo, +1 day setup. Say so before I start P0.

### Things you have to do yourself (I can't do for you)

- [ ] Buy a domain (or pick from one you own). Suggestion: `punchclock.<yourdomain>.com` if you have a parent domain.
- [ ] Sign up for: Fly.io, Vercel, Neon, Upstash, Cloudflare, Resend, Sentry, GitHub.
- [ ] Drop API keys / tokens for each into a shared password manager (1Password, Bitwarden) so I can pull them when wiring secrets.
- [ ] Decide on an admin email address that transactional emails come from (e.g. `noreply@punchclock.yourdomain.com`).

---

## P0 · Get it on the internet (Day 1, ~6h)

Goal: a working https URL the owner can sign into, with real (not default) secrets, no localhost references anywhere.

- [ ] **P0a. Containerize the API** — `packages/api/Dockerfile`
  - Multi-stage build: `node:20-slim` builder → distroless runtime.
  - Copy compiled `dist/` only; install prod deps with `pnpm install --prod`.
  - Expose `PORT` from env (Fly maps to 8080 internally).
  - Healthcheck endpoint already exists (`/health`); wire it as Fly's healthcheck.

- [ ] **P0b. Fly.io app setup** — `packages/api/fly.toml`
  - Region `ord` (or closest to the c-store) to minimize latency.
  - Memory 512 MB, 1 shared CPU.
  - Internal port 8080, websocket-friendly handler config.
  - Deploy via `fly deploy --remote-only`.

- [ ] **P0c. Provision Postgres + Redis**
  - Neon: create project, copy `DATABASE_URL` for prod + a separate `DATABASE_URL` for staging (branch).
  - Upstash: create Redis instance, copy `REDIS_URL`.
  - Run migrations against prod: `DATABASE_URL=<prod> pnpm db:migrate`.
  - (Do NOT seed prod with demo data — production seed is a separate task.)

- [ ] **P0d. Generate real secrets**
  - `JWT_SECRET`: 64 random bytes (`openssl rand -base64 64`).
  - `BCRYPT_ROUNDS`: 12 (current default is fine).
  - All into Fly secrets: `fly secrets set JWT_SECRET=... DATABASE_URL=... REDIS_URL=...`.

- [ ] **P0e. Deploy web to Vercel**
  - `packages/web` as the root, Next.js auto-detected.
  - Env vars on Vercel: `NEXT_PUBLIC_API_BASE_URL=https://api.punchclock.yourdomain.com`.
  - Set up the production domain + auto-cert.

- [ ] **P0f. DNS + HTTPS**
  - Cloudflare records: `api.punchclock.yourdomain.com` → Fly, `punchclock.yourdomain.com` → Vercel.
  - Both auto-cert (Fly via Let's Encrypt, Vercel via their own CA).
  - Verify TLS Labs A grade.

- [ ] **P0g. Lock down CORS + cookies**
  - `packages/api/src/config/env.ts`: `CORS_ALLOWED_ORIGINS` set to prod domain only.
  - Cookie flags: `secure: true, httpOnly: true, sameSite: 'lax'` in `packages/web/src/lib/auth.ts`.

- [ ] **P0h. Bootstrap the owner**
  - Owner runs the existing `/signup` bootstrap flow (one-time, only works while zero orgs exist) against prod.
  - Verify login → dashboard renders.

**Acceptance gate:** owner signs in at `https://punchclock.yourdomain.com`, sees the empty dashboard, the API on `api.punchclock.yourdomain.com` is reachable, certificates are valid, no localhost references in the wire.

---

## P1 · Operational hygiene (Day 2, ~6h)

Goal: when something breaks at 2am, you find out before the owner does, and you have a path to roll back.

- [ ] **P1a. Sentry wired into web + api**
  - `@sentry/nextjs` in `packages/web` + `@sentry/node` in `packages/api`.
  - DSN via env var; production-only (skip in dev).
  - Capture unhandled promise rejections + 5xx responses + frontend errors with sourcemaps.

- [ ] **P1b. Rate limiting**
  - `express-rate-limit` middleware on `/auth/login` (10/min/IP), `/me/pin` (5/min/user), `/auth/signup` (1/hour/IP).
  - Bucket fronted by Redis so it survives container restarts.

- [ ] **P1c. Helmet CSP**
  - Tighten `helmet()` defaults — current config is permissive.
  - Allow only the prod API origin in `connect-src`; nothing else.

- [ ] **P1d. GitHub Actions CI** — `.github/workflows/ci.yml`
  - On PR + main push: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm lint`.
  - Cache pnpm store between runs.
  - Block merge if any job fails (branch protection rule).

- [ ] **P1e. Auto-deploy on main push**
  - Fly: GitHub Action calls `flyctl deploy --remote-only` on main commits, after CI passes.
  - Vercel: native Git integration on `main`.
  - Both deploy to prod automatically. PR opens get a preview URL on Vercel + a `--strategy bluegreen` Fly target (or just leave Fly as direct since downtime tolerance is high on a single-tenant deploy).

- [ ] **P1f. Backup + restore drill**
  - Neon has daily PITR for the last 7 days on free tier — verify it's on.
  - Document a one-command restore: `flyctl ssh console` + sample command to import a Neon branch.
  - Run the drill once: take a snapshot, mutate prod data, restore, confirm reverted.

- [ ] **P1g. Uptime monitoring**
  - BetterStack (or UptimeRobot) pings `/health` on both web + api every 1 min.
  - Email + SMS alert on failure (you, not the owner).

**Acceptance gate:** push a deliberate failing test → CI blocks merge. Push a 500 from prod → Sentry captures it within 30s. Kill the Fly machine → BetterStack alerts within 90s. Restore from a Neon branch → 5-min drill passes.

---

## P2 · User-facing essentials (Day 3–4, ~10h)

Goal: a non-technical owner + their workers can actually use the system without you on a call.

- [ ] **P2a. Transactional email via Resend** — `packages/api/src/services/email.service.ts` (new)
  - Wrapper around `resend.emails.send()` with a tiny template helper.
  - Templates: welcome (new user invite), password-reset link, TOR-approved/rejected, cap-block warning to owner.
  - All templates plain text + minimal HTML, sender = `noreply@punchclock.yourdomain.com`.

- [ ] **P2b. Password reset flow**
  - `POST /auth/forgot-password` → email a single-use reset token (15 min TTL, stored in `password_reset_tokens` table, new migration 005).
  - `POST /auth/reset-password` → verify token, hash new password.
  - Web: `/forgot-password` page + `/reset-password?token=...` page.
  - Migration `005_password_reset_tokens.sql` with RLS.

- [ ] **P2c. Welcome email on user invite**
  - When owner posts `/admin/users`, generate a one-time setup token, email the user a link to set their initial password.
  - Existing `inviteUserSchema` is shipped, but the workflow is "owner sets the password manually" — flip to "owner doesn't see the password; system emails the user".

- [ ] **P2d. TOR approval notifications**
  - When manager approves/rejects, email the requester.
  - When a worker submits, email the org's managers (cap to 5).

- [ ] **P2e. Document storage via Cloudflare R2** — replace the URL-only stub
  - `POST /api/v1/me/documents` accepts `multipart/form-data` with a single file.
  - Server signs a presigned upload URL via `@aws-sdk/s3-request-presigner` (R2 is S3-compatible).
  - 10 MB cap, JPEG/PDF only, server-side virus scan deferred.
  - `storage_url` on the row stores the R2 object key, NOT a public URL — manager view fetches a fresh presigned GET on click.

- [ ] **P2f. Owner onboarding doc** — `docs/owner-handbook.md`
  - Plain-English how-to: invite a worker, configure cap, run payroll, restore a backup, contact support.
  - Lives at `/dashboard/help` so the owner can find it without leaving the app.

**Acceptance gate:** owner invites a new worker → worker gets the email → clicks the link → sets a password → signs in. Worker forgets password → uses /forgot-password → resets → signs in. Worker uploads a PDF on Documents → manager opens it → renders. Manager approves a TOR → requester gets an email within 60s.

---

## P3 · Pre-launch polish (Day 5, ~6h)

- [ ] **P3a. Production seed script** — `packages/api/src/db/prod-seed.ts`
  - One-time, **owner-only**, runs after they bootstrap-signup.
  - Inserts: their store's geofence (lat/long the owner gives during signup), the default cap (8h/40h), no demo workers.
  - Idempotent — refuses if the org already has more than 1 user.

- [ ] **P3b. Audit-log retention policy**
  - Add `audit_logs_retention_days` column to `organizations` (default 365).
  - Cron job (Fly machine on a schedule, or a node-cron in-process) prunes rows older than that. Migration 006.

- [ ] **P3c. Health/version endpoint**
  - `GET /health` returns `{ status: 'ok', version: '<git sha>', db: 'up' | 'down', redis: 'up' | 'down' }`.
  - Web shows the version in the footer (truthful build provenance).

- [ ] **P3d. Legal pages**
  - `/terms` + `/privacy` static pages — plain English, single-tenant, written for the owner's c-store. Templates exist online — use ToS;DR generator as a starting point.
  - Footer link on login + signup pages.

- [ ] **P3e. README + deploy runbook** — `docs/deploy.md`
  - "How to ship a change" (PR → CI → merge → auto-deploy).
  - "How to roll back" (Fly: `fly releases --image`, Vercel: rollback button).
  - "How to restore from backup" (Neon: branch + swap).
  - "How to add a new env var" (Fly secrets + Vercel env + redeploy).

**Acceptance gate:** the runbook is correct end-to-end (run through it from scratch on a sibling Fly app), the version sha shows on the web footer, ToS/Privacy links exist, audit log prune ran once without complaint.

---

## P4 · Mobile v2 catch-up (Day 6, ~6h) [OPTIONAL — skip if web-only is enough]

If the owner's workers will use phones, the v2 features that exist only on web need a mobile path. Otherwise the punch flow + sync queue (v1) still works on the existing mobile app.

- [ ] **P4a. Mobile clock: PIN entry**
  - Show PIN input when org `punch_verification_methods` includes `pin`.
  - Mirror the web behavior: "set a PIN" prompt if `pin_hash` is null.

- [ ] **P4b. Mobile clock: cash drawer prompt**
  - Same modal as web when `feature_cash_drawer` is on + worker is onshore.

- [ ] **P4c. Time off + Trades on mobile**
  - Smallest viable path: WebView pointing at the existing web pages with a magic-link auth so the user doesn't re-sign-in. Or native React Native screens — 4× the work.
  - Recommendation: WebView for v1 mobile-of-v2, native later if owner pays.

- [ ] **P4d. EAS Build + TestFlight / Internal App Sharing**
  - Set up EAS account + project + iOS provisioning + Android keystore.
  - Push a TestFlight build the owner can install on their iPhone + their workers can install via TestFlight invite or Internal App Sharing.

**Acceptance gate:** owner installs the TestFlight build, signs in, punches in with PIN, submits a TOR via the WebView. Worker on Android does the same via Internal App Sharing.

---

## P5 · Cutover (Day 7, ~3h)

- [ ] **P5a. Smoke test in prod**
  - Run the existing `tools/record-demo.mjs` against the prod URL (param the script).
  - Watch the video. If anything looks off, fix before owner sees it.

- [ ] **P5b. Owner walk-through**
  - 30-min call. Show them: invite a worker, set their PIN policy, run a payroll export, restore from a backup.
  - They sign off, you hand over the credentials envelope.

- [ ] **P5c. Tag the release**
  - `git tag v1.0.0 && git push --tags`.
  - GitHub release notes — Phases A–D summary + deploy notes.

- [ ] **P5d. Post-launch monitoring**
  - First 48h: check Sentry + BetterStack daily.
  - First week: schedule a "is anything weird?" check-in with the owner.

**Acceptance gate:** owner is using the system in production with real workers. You have not been paged.

---

## Out of scope

Anything multi-tenant: no public signup, no per-customer billing, no tenant isolation hardening beyond what RLS already gives. The bootstrap-signup → owner-invites-workers flow stays as-is. If you ever want SaaS, that's a separate plan.

Also out of scope: SSO/SAML, advanced compliance (SOC 2), the v2 deferrals (selfie capture, device pinning, kiosk QR, push notifications, multi-store full UI, DB export bundle). All viable follow-ups, none required for this c-store to use the product.

---

## How we'll work

Same as the v2 plan that just shipped:

1. I execute one phase at a time (P0 → P1 → P2 → P3 → P4 → P5).
2. After each phase, I run the acceptance gate and report back with screenshots + commit refs.
3. You approve before I move to the next phase.
4. Anything that needs your hands (account signup, DNS, payment) gets called out so you can do it in parallel.

If you say "go" I'll start on P0a (the Dockerfile) and the cloud-account checklist at the top. You can knock out the account signups while I work.
