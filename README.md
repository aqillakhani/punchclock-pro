# PunchClock Pro

Internal-use clock-in / clock-out and workforce management platform.
Self-hosted, no SaaS subscriptions: Postgres + Redis + Node + a single VPS.

## Monorepo Layout

```
packages/
├── shared/    # Shared types, Zod schemas, constants
├── api/       # Node.js + Express backend (TypeScript)
├── web/       # Next.js 15+ dashboard (App Router)
└── mobile/    # React Native app (Expo Router)
```

## Prerequisites

- Node.js >= 20
- pnpm >= 9 (`npm i -g pnpm`)
- Docker Desktop (for local Postgres + Redis)

## Getting Started

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env file
cp .env.example .env

# 3. Start local services (Postgres + Redis)
pnpm db:up

# 4. Run migrations
pnpm db:migrate

# 5. Start dev servers
pnpm dev
```

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Run all packages in dev mode |
| `pnpm build` | Build all packages |
| `pnpm test` | Run all tests |
| `pnpm lint` | Lint all packages |
| `pnpm typecheck` | Type-check all packages |
| `pnpm db:up` | Start Postgres + Redis containers |
| `pnpm db:down` | Stop containers |
| `pnpm db:migrate` | Run database migrations |

## Architecture

See [lucky-spinning-pillow.md](https://file+.vscode-resource.vscode-cdn.net/C:/Users/claws/.claude/plans/lucky-spinning-pillow.md)
for the full implementation plan.

Key pillars:
- **Event-sourced time records** — every punch is an immutable event
- **Offline-first mobile** — WatermelonDB with 72-hour offline resilience
- **Real-time dashboard** — Socket.io + Redis adapter
- **Self-hosted auth** — bcrypt-hashed passwords + signed JWTs, no third-party identity provider

## Auth model

This is an internal tool, not a SaaS. The first time you bring up the API,
hit `POST /auth/signup` once to bootstrap the singleton organization and
the first owner. After that, `POST /auth/signup` returns 403 — every
subsequent user is created by an existing owner via
`POST /api/v1/admin/users`. Workers log in with email + password.
