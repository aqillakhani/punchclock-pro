# Critical: RLS was bypassed in production (tenant isolation)

**Status: RESOLVED in production on 2026-07-28.** `punchclock-api` now connects as
`punchclock_app` (`rolsuper=f`, `rolbypassrls=f`), verified end to end — see
[Rollout record](#rollout-record-2026-07-28) below. The code fix is on `feat/time-corrections` (PR #3).

**Severity:** critical — cross-tenant data exposure.
**Found:** 2026-07-28, by an integration test that seeds two organizations and asserts neither can see the other.

**Actual exposure: none.** The production database held exactly **one organization** at the
time of the fix, so there was no second tenant for data to leak to. The vulnerability was
real and would have been exploited by the first additional customer; it was closed before
that happened. No data audit is required.

## What was wrong

Tenant isolation in this app is enforced by Postgres row-level security. Migrations
`002`, `003` and `007` put a `tenant_isolation` policy on every tenant-scoped table, and
`withTenantDb()` sets `app.current_org_id` per request. Because that was assumed to be
airtight, many queries carry **no `organization_id` predicate of their own** — for example
`GET /api/v1/admin/timesheets` selects users with only `WHERE deleted_at IS NULL AND status='active'`.

RLS has one silent failure mode: **a role with `SUPERUSER` or `BYPASSRLS` skips every policy**,
with no error and no log line.

The official `postgres` Docker image creates `POSTGRES_USER` as a **superuser**. Both
`docker-compose.yml` and `deploy/db/fly.toml` set `POSTGRES_USER=punchclock`, and the API's
`DATABASE_URL` connected as exactly that role. So in production, RLS never applied to a single query.

### Proven impact

`packages/api/tests/integration/tenant-isolation.test.ts` reproduced it. Signed in as the owner
of organization A, the API returned:

- every **user** in every other organization — email, role, and `pay_rate`
- every **time entry** in the database, including GPS coordinates
- the admin **timesheet roll-up** for all workers across all tenants

A correction request naming another tenant's entry returned `403` (meaning the row was read)
rather than `404`.

## The fix

Connect the running API as a dedicated role that is explicitly `NOSUPERUSER NOBYPASSRLS`.
That single change makes every existing policy effective — no query rewriting required.

- `packages/api/src/db/create-app-role.ts` provisions `punchclock_app` with only
  `SELECT/INSERT/UPDATE/DELETE` on `public`, no DDL, and verifies the attributes afterwards.
- `packages/api/src/db/owner-connection.ts` lets `db:migrate`, `db:seed` and
  `db:create-app-role` switch to `OWNER_DATABASE_URL`, since the app role deliberately
  cannot run DDL.
- The integration suite now connects as the app role and asserts
  `rolsuper=false, rolbypassrls=false`, so a regression fails CI rather than leaking data.

## Production rollout

The application code needs no change beyond this branch; the work is a new role plus a
secret swap. Nothing is destructive and it is reversible by pointing `DATABASE_URL` back.

```bash
# 1. Tunnel to the Fly database.
flyctl proxy 15432:5432 -a punchclock-db

# 2. In another shell — the owner password is in ~/pcp-deploy-secrets.env.
PW=$(grep '^POSTGRES_PASSWORD=' ~/pcp-deploy-secrets.env | cut -d= -f2-)
APP_PW="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"

# 3. Apply migration 007 and create the least-privilege role.
OWNER_DATABASE_URL="postgres://punchclock:$PW@localhost:15432/punchclock" \
DATABASE_SSL=true \
  pnpm --filter @punchclock/api db:migrate

OWNER_DATABASE_URL="postgres://punchclock:$PW@localhost:15432/punchclock" \
DATABASE_SSL=true APP_DB_PASSWORD="$APP_PW" \
  pnpm --filter @punchclock/api db:create-app-role

# 4. Verify the role really cannot bypass RLS.
psql "postgres://punchclock:$PW@localhost:15432/punchclock" \
  -c "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='punchclock_app';"
#    expected: punchclock_app | f | f

# 5. Point the API at it. Note: no `sslmode` in the URL — the app sets SSL
#    via DATABASE_SSL (see docs/deploy.md).
flyctl secrets set \
  DATABASE_URL="postgres://punchclock_app:$APP_PW@punchclock-db.internal:5432/punchclock" \
  -a punchclock-api

# 6. Store APP_PW alongside the other secrets — Fly secrets are write-only.
echo "APP_DB_PASSWORD=$APP_PW" >> ~/pcp-deploy-secrets.env
```

Then confirm the deployment is healthy and isolated:

```bash
curl -s https://punchclock-api.fly.dev/health     # {"status":"ok","db":"up",...}
```

### Rollback

Set `DATABASE_URL` back to the `punchclock` owner role and redeploy. That restores the
previous behaviour — including the vulnerability — so treat it as a last resort. The prior
value is kept as `DATABASE_URL_INTERNAL` in `~/pcp-deploy-secrets.env`.

## Rollout record (2026-07-28)

Applied to production against the deployed image `1b966c7`. Migration 007 was **not** applied —
the role fix does not need it, and it belongs with the PR #3 deploy.

Pre-flight checks, all of which had to pass before the secret was touched:

| Check | Result |
| --- | --- |
| API runs migrations at boot or via `release_command`? | No — neither. The app only does DML, so a role without DDL is safe. |
| Auth flows survive the restricted role? | 13 integration tests added (`tests/integration/auth-under-rls.test.ts`). Login, forgot/reset password and invite all rely on the `app.bypass_rls` opt-out, which is a GUC and not a role privilege. |
| Role attributes | `rolsuper=f, rolbypassrls=f, rolcreatedb=f, rolcreaterole=f` |
| Grants | SELECT/INSERT/UPDATE/DELETE on all 20 tables |
| RLS actually enforcing | 0 users visible with no org context; 2 with the org context the app sets; 2 via the bypass path |

Post-swap verification against `https://punchclock-api.fly.dev`:

- `/health` → `{"status":"ok","db":"up"}`
- A **real login** succeeded and returned a working token — proving the bypass path still
  resolves a user across organizations. A 401 on bogus credentials proves nothing here,
  because a broken RLS setup returns the same 401; a successful login is the only
  meaningful signal. A temporary user was created for this and deleted immediately after.
- `/auth/me` with that token returned the right record — proving the tenant-scoped read
  path works under `app.current_org_id`.
- Row counts unchanged afterwards: 1 organization, 2 users, 2 time entries.

## Follow-up worth doing

1. **Defence in depth.** RLS is currently the *only* thing scoping several queries. Adding an
   explicit `organization_id = $1` predicate to the admin list endpoints would mean a future
   connection-string mistake degrades instead of leaking.
2. **`rls_bypass()` is reachable by the app role.** The policies honour an `app.bypass_rls`
   GUC, and any connection can set it. It is only set by `withTenantTx(null, …)` for system
   jobs today, but a SQL-injection bug anywhere would become a full tenant-isolation bypass.
   Consider gating it on the owner role instead.
3. **Audit production data** for whether any cross-tenant read actually occurred, if more than
   one organization has ever existed in the production database.
