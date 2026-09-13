# Pay periods & auto clock-out

Two protections for the time record, both closing gaps the market audit flagged.

## Pay period locking

### What it's for

Once payroll has been run for a set of dates, nothing may retroactively change the hours in
them. Without a lock, a correction approved a week later silently contradicts a payroll run
that has already been paid — the timesheet and the paycheque disagree and nobody notices.

### How boundaries work

Periods are **derived**, not materialised by a job, so there is nothing to fall behind:

| Type | Boundaries |
| --- | --- |
| `weekly` | 7-day blocks stepping from the anchor date |
| `biweekly` | 14-day blocks stepping from the anchor date |
| `semimonthly` | 1st–15th and 16th–end of month (anchor ignored) |
| `monthly` | Calendar month (anchor ignored) |

`pay_period_anchor_date` is any date known to be the **first day** of a period. Weekly and
biweekly step forwards *and backwards* from it, so an organisation configured today can still
lock last quarter.

A row exists in `pay_periods` only once a period has been locked. No row means open, which
keeps the table tiny and "is this date locked?" a single indexed lookup.

Dates are evaluated in the **organisation's timezone**, the same way timesheets aggregate — a
shift starting 23:00 local belongs to the local date, not the UTC one.

### What a lock blocks

Every retroactive write path is gated, and each checks both where a record *is* and where it
would *move to*, so an entry can be shifted neither out of nor into a locked period:

- filing a correction request (refused early rather than left to fail at approval)
- **approving** one — re-checked at decision time, because a period can be locked between a
  request being filed and a manager getting to it
- manager create / edit / delete of a time entry

**Live punching is deliberately never blocked.** Trapping a worker on the clock because an
admin locked the current period would be worse than the accounting problem locking guards
against. Rejecting a correction is also still allowed while locked — it changes no hours.

### Unlocking

Owner-only, and it **requires a reason**, which lands in `audit_logs` under
`pay_period_unlocked`. Reopening dates payroll has already paid is exactly the event an
auditor will want explained.

Managers can *see* lock status — it governs what they may edit — but only an owner may lock
or unlock.

## Auto clock-out

### What it's for

A forgotten punch-out is not just untidy. The partial unique index
`uniq_time_entries_open_per_user` permits one open entry per person, so a stale entry
**blocks that worker's next punch-in entirely** — and before the correction feature existed,
nobody could clear it.

### Where the clock stops

The entry is closed at **`punch_in + auto_clock_out_minutes`**, not at the moment the sweep
runs. Closing "now" would pay for every hour between the forgotten punch and whenever the job
happened to fire — arbitrary, always too generous, and not reproducible. Capping is
defensible and gives the same answer whether the job is punctual or a day late.

The entry is flagged `auto_closed`, gets an explanatory note, and appends a `punch_out` event
with `autoClosed: true`. An audit row is written with **no actor** — the system did it, not a
person. The worker is expected to file a correction with the real time, which is precisely
what the correction workflow exists for.

Any break still running is closed at the same instant, so a forgotten lunch is still deducted
rather than silently becoming paid time.

### Off by default

`auto_clock_out_minutes` is NULL until an owner opts in. Switching it on changes what people
are paid, so an existing installation must choose it rather than discover it afterwards.
Accepted range is 60–1440 minutes; the floor stops a typo from closing everyone's shift the
moment they clock in.

### Scheduling the sweep

```bash
pnpm --filter @punchclock/api db:auto-clock-out
```

Runs across every organisation that has opted in, so it needs RLS bypassed — it uses
`withTenantTx(null, …)`, the same system-job context as the audit-log pruner.

Hourly is a sensible cadence. Because the close time derives from `punch_in + cap` rather than
from when the job runs, a late sweep produces an identical result; it only delays when the
worker sees it. The job is idempotent — a second run closes nothing more.

On Fly, run it as a scheduled machine:

```bash
flyctl machine run . \
  --schedule hourly \
  --config packages/api/fly.toml \
  --dockerfile packages/api/Dockerfile \
  --command "node dist/db/auto-clock-out-cli.js" \
  -a punchclock-api
```

## Permissions

| Action | owner | manager | employee | viewer |
| --- | :---: | :---: | :---: | :---: |
| `view:pay-periods` | ✅ | ✅ | — | ✅ |
| `lock:pay-period` | ✅ | — | — | — |

## Tests

- `packages/api/tests/unit/pay-period.test.ts` — boundary maths for all four schedules,
  including dates *before* the anchor, leap years, month lengths and a DST transition, plus
  the auto clock-out cap.
- `packages/api/tests/integration/pay-period-lock.test.ts` — every write path refused while
  locked, approval re-checked after a late lock, unlock-with-reason, and proof that live
  punching still works.
- `packages/api/tests/integration/auto-clock-out.test.ts` — capping, break deduction,
  unblocking the next punch-in, idempotency, system audit row, and per-organisation opt-in.
