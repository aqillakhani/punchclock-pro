# Time corrections

How a worker fixes a punch after the fact, and how the record stays trustworthy while they do.

## Why it exists

Punches are wrong all the time: someone forgets to clock out, clocks in on the wrong job, or
never clocks in because their phone was dead. Before this feature there was **no edit path at
all** — not for the worker, not for a manager, not even for the owner. The `entry_edited` and
`entry_deleted` event types and the `is_manual` column existed in the schema but nothing ever
wrote them. The only remedy was raw SQL against production.

Every comparable product (Deputy, Homebase, When I Work, Buddy Punch, QuickBooks Time) treats
an employee-initiated correction request as table stakes, and FLSA recordkeeping expects a
worker to be able to dispute what was recorded about them.

## The shape of it

```
worker sees a wrong punch on My Timesheet
  └─ "Fix" → modal: adjust in/out, or delete, plus a REQUIRED reason
       └─ POST /api/v1/me/corrections            → status: pending
            └─ approvers emailed; nav badge appears
                 └─ manager/owner opens Corrections
                      ├─ Approve                  → applied as requested
                      ├─ Adjust… → Approve        → applied with the manager's times
                      └─ Reject                   → time record untouched
```

Three request types:

| `requestType`   | Means                                | Needs                        |
| --------------- | ------------------------------------ | ---------------------------- |
| `edit_times`    | this punch has the wrong time        | `timeEntryId` + ≥1 new time  |
| `add_entry`     | I worked a shift that was never clocked | both times, no `timeEntryId` |
| `delete_entry`  | this entry is a duplicate            | `timeEntryId` only           |

## Rules worth knowing

- **A reason is mandatory.** Enforced in the Zod schema and by a `CHECK` constraint, because a
  DOL audit asks *why* a time record moved.
- **History is never rewritten.** Approval appends an `entry_edited` / `entry_deleted` event to
  `time_entry_events` and updates the `time_entries` projection. The originally punched times
  stay recoverable forever. See `applyEditTimes()` in `time-correction.service.ts`.
- **Nobody approves their own.** A manager may file a correction on their own timesheet, but
  another approver has to decide it — otherwise "request a change" is just "change it".
- **One pending request per entry.** A partial unique index prevents two approvals racing and
  the second silently overwriting the first.
- **A 60-day window** (`CORRECTION_MAX_AGE_DAYS`). Past that, payroll is presumed settled and a
  manager must edit directly, leaving their own name on the audit trail.
- **Added shifts cannot overlap** an existing one — double-counted hours are worse than a
  rejected request.
- **Corrected entries stay `status='completed'`.** Every timesheet and payroll query filters on
  that status, so promoting them to `'edited'` would drop them out of the worker's hours.
  Provenance lives in `is_manual`, the event log, and `audit_logs` instead.

## Direct manager edits

Managers and owners can also change a record without a request — the escape hatch for a
geofence false positive or a worker who has left. All of these require a reason and are audited:

```
POST   /api/v1/admin/time-entries          create a shift from scratch
PATCH  /api/v1/admin/time-entries/:id      change times / notes
DELETE /api/v1/admin/time-entries/:id?reason=…   soft-delete
```

## Break accounting (fixed alongside this)

`time_entries.duration_minutes` used to be raw wall-clock time, and nothing subtracted unpaid
breaks — so a 30-minute unpaid lunch was paid. It now means **payable** minutes:

```
gross_minutes        = punch_out_at - punch_in_at
unpaid_break_minutes = completed breaks of type 'lunch' or 'unpaid'
duration_minutes     = gross_minutes - unpaid_break_minutes     ← what payroll pays
```

Paid rest breaks (`break_type='standard'`) are deliberately **not** deducted: under the FLSA,
rest periods of roughly 20 minutes or less are compensable. Migration `007` backfills existing
rows and ships a reconciliation query to quantify the change.

A break still running at punch-out is closed at the punch-out instant (`closeOpenBreaks`),
because a forgotten break would otherwise never be counted and the meal period would quietly
become paid time.

## Permissions

| Action                       | owner | manager | employee | viewer |
| ---------------------------- | :---: | :-----: | :------: | :----: |
| `view:time-correction`       |  ✅   |   ✅    |    ✅    |   —    |
| `submit:time-correction`     |  ✅   |   ✅    |    ✅    |   —    |
| `approve:time-correction`    |  ✅   |   ✅    |    —     |   —    |
| `edit:time-entry` (direct)   |  ✅   |   ✅    |    —     |   —    |

## Tests

- `packages/api/tests/unit/time-correction.test.ts` — the hours-delta maths an approver relies on.
- `packages/api/tests/integration/corrections.test.ts` — the full lifecycle, authorization
  boundaries, self-approval refusal, and the immutability guarantee.
- `packages/api/tests/integration/break-deduction.test.ts` — unpaid breaks never reach payroll.
- `tools/e2e-corrections.mjs` — a real Chromium driving employee → manager → applied change.
