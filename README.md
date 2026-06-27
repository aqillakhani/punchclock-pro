# punchclock-pro

![CI](https://github.com/aqillakhani/punchclock-pro/actions/workflows/ci.yml/badge.svg)

Self-hosted workforce time-tracking platform: punch in/out with GPS, real-time team dashboard, shift scheduling, offline-first mobile, event-sourced storage. No SaaS subscriptions.

**Live demo:** [CONFIRM] · **Walkthrough:** [CONFIRM]

## Problem

Teams managing hourly workers need a self-hosted alternative to SaaS time-tracking that supports offline-first mobile punching, real-time management dashboards, geofence-validated location capture, and complex overtime calculation (federal + California) without third-party auth dependencies.

## What it does

- **Punch in/out with GPS** — Workers clock in via REST API with location capture; events stored as immutable records in PostgreSQL with full audit trail
- **Automatic overtime calculation** — Federal 8/40 and California daily/weekly overtime detection; flag double-time eligibility from shift data
- **Real-time team dashboard** — Live punch status and team view via Socket.io + Redis; see who's clocked in across the entire workforce
- **Geofence validation** — PostGIS distance queries enforce location-based punch acceptance before events persist
- **Offline-first mobile app** — React Native + WatermelonDB persistent queue; punches queue locally and batch-sync when connectivity returns
- **Shift & schedule management** — CRUD shifts with conflict detection; admin-only creation; workers see assigned shifts

## Stack

**Backend**: Node 20 / Express 4 / TypeScript | PostgreSQL 16 (TimescaleDB + PostGIS) | Redis 7 | Socket.io 4  
**Web**: Next.js 15 / React 18 / Tailwind / React Query  
**Mobile**: Expo / React Native / WatermelonDB  
**Monorepo**: pnpm 9 / Turborepo  
**Auth**: bcrypt + JWT (self-hosted, no Clerk/Auth0)  
**Tooling**: Zod schemas, Sentry, S3-compatible document storage  

## Architecture

```
pnpm/Turbo monorepo (4 packages):
  shared/    → TypeScript types + Zod schemas
  api/       → Express REST API + Socket.io server
  web/       → Next.js dashboard (App Router)
  mobile/    → Expo app (Expo Router)

Flow:
  Mobile punch → JWT auth → Express /api/v1/time-tracking/punch-in
    → Geofence check (PostGIS) → Event sourced to PostgreSQL
    → Socket.io broadcast via Redis adapter
    → Web dashboard live-updates
    
  Mobile offline: Punch → WatermelonDB queue → sync on reconnect
```

## Run it

### Prerequisites

- Node 20 LTS
- pnpm 9 (`npm i -g pnpm`)
- Docker Desktop

### Local dev (5 min)

```bash
# Install dependencies
pnpm install

# Copy env (defaults work locally)
cp .env.example .env

# Start Postgres (TimescaleDB + PostGIS) + Redis
pnpm db:up

# Run migrations
pnpm db:migrate

# Start all dev servers in parallel
pnpm dev
# → Express API: http://localhost:4000
# → Next.js dashboard: http://localhost:3000
# → Expo dev server: ready for iOS/Android
```

### Bootstrap first user (one-time)

```bash
# POST /auth/signup only succeeds when zero organizations exist
curl -X POST http://localhost:4000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "organizationName": "My Business",
    "ownerEmail": "owner@example.com",
    "ownerPassword": "ChangeMe123!",
    "ownerFirstName": "Acme",
    "ownerLastName": "Owner",
    "timezone": "America/New_York"
  }'
# Returns JWT token for subsequent API calls
```

### Punch in with cURL

```bash
TOKEN=<from signup response>
curl -X POST http://localhost:4000/api/v1/time-tracking/punch-in \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"clientGeneratedId\": \"$(uuidgen)\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
    \"location\": { \"latitude\": 40.7128, \"longitude\": -74.006, \"accuracy\": 8 }
  }"
```

### Test & CI

```bash
pnpm test           # Unit tests (API + mobile)
pnpm typecheck      # Full monorepo type check
pnpm lint           # ESLint
pnpm build          # Build all packages
```

CI runs on every push to `main` and PRs: lint, typecheck, API unit tests (with Postgres), web build.
