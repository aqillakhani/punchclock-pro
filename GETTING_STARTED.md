# Getting Started

This is the **internal-use** foundation of **PunchClock Pro**. It contains
a running monorepo with four packages (`shared`, `api`, `web`, `mobile`)
plus local Postgres/Redis via Docker. No SaaS subscriptions — auth is
self-hosted (bcrypt + JWT). Follow the steps below to boot the stack on
a fresh machine.

## 1. Install prerequisites

- [Node.js 20 LTS](https://nodejs.org)
- [pnpm 9](https://pnpm.io/installation) (`npm i -g pnpm`)
- [Docker Desktop](https://docs.docker.com/desktop/)
- (mobile only) [Expo CLI](https://docs.expo.dev/more/expo-cli/)

## 2. Install dependencies

```bash
pnpm install
```

## 3. Configure environment

```bash
cp .env.example .env
# Defaults work for local dev against Docker. For production, replace
# JWT_SECRET with 32+ random bytes and update DATABASE_URL.
```

## 4. Start Postgres + Redis

```bash
pnpm db:up
```

On first start, Postgres runs `packages/api/src/db/init/00-extensions.sql`
automatically, which installs `uuid-ossp`, `pgcrypto`, `postgis`, and
`timescaledb`.

## 5. Run database migrations

```bash
pnpm db:migrate
```

This applies every `.sql` file in `packages/api/src/db/migrations/` in
order and records them in the `schema_migrations` table.

## 6. Start dev servers

```bash
# Run everything in parallel
pnpm dev

# Or individual packages:
pnpm --filter @punchclock/api dev       # Express API on :4000
pnpm --filter @punchclock/web dev       # Next.js dashboard on :3000
pnpm --filter @punchclock/mobile start  # Expo dev server
```

## 7. Bootstrap the singleton org + first owner

This endpoint only succeeds once — when zero organizations exist. After
that, every user is created via `POST /api/v1/admin/users`.

```bash
curl -X POST http://localhost:4000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "organizationName": "My Business",
    "ownerEmail": "owner@example.com",
    "ownerPassword": "ChangeThisPassword123!",
    "ownerFirstName": "Acme",
    "ownerLastName": "Owner",
    "timezone": "America/New_York"
  }'
```

You'll get back a JWT in the `token` field. Use it as
`Authorization: Bearer <token>` for subsequent requests. Subsequent
logins go through `POST /auth/login` with `{ email, password }`.

## 8. Punch in from the API

```bash
TOKEN=<paste token from signup or login>
curl -X POST http://localhost:4000/api/v1/time-tracking/punch-in \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"clientGeneratedId\": \"$(uuidgen)\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"location\": { \"latitude\": 40.7128, \"longitude\": -74.006, \"accuracy\": 8 }
  }"
```

## 9. Add a worker (admin-only)

```bash
curl -X POST http://localhost:4000/api/v1/admin/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "email": "worker@example.com",
    "password": "WorkerInitialPassword123!",
    "firstName": "Worker",
    "role": "employee"
  }'
```

The worker can then `POST /auth/login` with their email and password.

## Running tests

```bash
pnpm --filter @punchclock/api test      # unit tests (overtime, geofence, schemas)
pnpm --filter @punchclock/web test      # vitest
pnpm typecheck                          # all packages
```

## What's implemented vs. what's next

**Implemented:**
- Monorepo with pnpm workspaces + Turborepo
- Docker Compose (Postgres + TimescaleDB + PostGIS, Redis)
- Full SQL schema with row-level security + event-sourced time events
- Forward-only migration runner
- Express API with auth, RLS, validation, error, logger middleware
- bcrypt password hashing + JWT-based auth (signup bootstrap, login, /me)
- Time-tracking endpoints (punch in/out, breaks, current, entries)
- Geofence endpoints with PostGIS distance queries
- Scheduling endpoints (shifts CRUD)
- Admin endpoints (create/list/archive users, org settings)
- Sync endpoints (changes pull, batch push) for offline-first mobile
- Socket.io server wired to JWT auth
- Overtime calculation (federal + California)
- 23 API + 13 mobile unit tests (overtime, geofence, schemas, sync queue)
- Next.js 15 dashboard scaffold with Clock screen + live team view
- Expo Router mobile app with offline-first punch + persistent sync queue

**Not yet wired:**
- Login + signup UI on web and mobile (use curl until then)
- Full WatermelonDB native integration on mobile (needs EAS prebuild)
- Local-first optimistic punch flow on mobile (still server-first today)
- Web dashboard pages: timesheets, scheduling drag-and-drop, geofence
  map, reports, onboarding
- Biometric/PIN/QR-code worker auth
- E2E tests, deployment runbook

**Descoped (this is internal-use, not a SaaS):**
- ~~Stripe billing & subscription management~~
- ~~Free vs Pro plan tier enforcement~~
- ~~Clerk SSO~~ — replaced with self-hosted bcrypt + JWT
- ~~QuickBooks / Gusto OAuth integrations~~
- ~~Marketing landing page, 60-second SaaS onboarding wizard~~

See `~/.claude/plans/lucky-spinning-pillow.md` for the full roadmap.
