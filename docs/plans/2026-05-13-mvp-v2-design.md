# MVP v2 — Design Doc

**Date:** 2026-05-13
**Status:** Awaiting approval to implement
**Predecessor:** v1 demo MVP shipped 2026-05-12 (`docs/plans/2026-05-08-bootstrap-signup-web.md`)

---

## 1. Goals

Close the gap between the v1 demo and a real product a 50-employee c-store can use day-to-day. Four owner-stated requirements drive this round:

1. **Role-based visibility** — workers shouldn't see manager-only tabs; managers shouldn't see owner-only settings.
2. **Hard hour caps** — no individual can log more than **8 h/day** or **40 h/week**; the system blocks the punch, doesn't just warn.
3. **Onshore / offshore properly modeled** — not just a label. Different rules, tax handling, payroll output.
4. **Accounting layer** — payroll exports that go straight into QuickBooks; a labor-cost widget on the dashboard.

Plus: every "feature I'd add at zero cost" that materially competes with When I Work / Homebase / Deputy.

## 2. Non-goals

- POS integration (requires partner API access — out of scope until they pick a POS).
- Running actual payroll (no money movement; we export to QB and let QB do payments).
- Native biometric clock-in (deferred to original-plan Phase 5).
- SMS notifications (Twilio costs $$). Push via Expo + email-only.
- Going public / multi-tenant SaaS — still single-org internal-use.

## 3. Research findings — what informed the design

### 3a. Competitor matrix (sources cited)

| Feature | Homebase | When I Work | Deputy | Hubstaff |
|---|---|---|---|---|
| Time clock + geofence | ✓ | ✓ | ✓ | ✓ (designed for remote) |
| Drag-and-drop scheduling | ✓ | ✓ | ✓ | ✗ |
| Worker self-service | ✓ | ✓ | ✓ | ✓ |
| Photo on clock-in | ✓ | ✓ | ✓ (premium) | ✓ |
| PIN kiosk | ✓ | ✓ | ✓ | ✗ |
| Hard daily/weekly caps | ✗ (warn only) | ✗ (warn only) | ✓ (Premium) | ✗ |
| Meal break enforcement | ✓ | ✓ | ✓ (best-in-class) | ✗ |
| 1099 vs W-2 distinction | ✗ (W-2 only) | ✗ (W-2 only) | partial | ✓ |
| QB / payroll OAuth | ✓ | ✓ | ✓ | ✓ |
| Time-off / PTO | ✓ | ✓ | ✓ | ✓ |
| Shift swap | ✓ | ✓ | ✓ | ✗ |
| Hiring / onboarding | ✓ (unique) | ✗ | ✗ | ✗ |
| Fair Workweek 14-day notice | partial | ✓ (Premium) | ✓ | ✗ |
| Built-in messaging | ✗ | ✓ (WorkChat) | ✓ | ✓ |
| Pricing (1 site, 15 emp) | $24/mo flat | $37.50–75/mo | $5–9/user | $5–11/user |

Source: Homebase / When I Work / Deputy / Hubstaff vendor pages + comparison reviews on softwarefinder, stackscored, performancereviewssoftware (May 2026).

Key takeaway: **Deputy is the only one that hard-blocks caps.** Everyone else warns. The owner asked for hard-block — so we beat the field on this one specific axis.

### 3b. Onshore / offshore — what the distinction actually is

Per the synthesis (Wing Assistant, OnlineJobs.ph, Upwork market notes 2025–2026):

- **Onshore = W-2 employee** working at the store. FLSA applies (overtime, meal breaks, minimum wage by state). Geofence enforcement makes sense. Employer withholds tax. Workers' comp + unemployment apply.
- **Offshore = 1099 independent contractor**, typically in Philippines / India / LatAm, paid hourly via Wise/PayPal/Upwork. **FLSA does not apply.** No employer-side tax withholding. Self-employment tax is the contractor's problem. Geofence is moot (they're not at the store). State law (CA, NY) presumes employment unless contractor status is genuine — misclassification penalty up to **$1,000 / worker**.

Product implication: **`worker_type` is a first-class column, not a soft label.** It drives:
- Whether geofence is enforced (W-2 only)
- Whether 8h/40h caps apply (W-2 only — 1099 contractors set their own hours, it's a contractor red flag if employer dictates them)
- Whether OT calc runs (W-2 only)
- Which fields appear on the payroll export (W-2: tax withholding columns; 1099: gross payment only)
- What currency / timezone label shows (1099 may be paid in PHP/INR but tracked in USD)

We also keep `worksite` (`onshore` | `offshore`) for narration / UI grouping, separate from `worker_type` (`W2` | `1099`). They usually correlate but aren't the same thing — a c-store could have a W-2 remote bookkeeper.

### 3c. Hard caps — the implementation question

Owner said: "no one can log more than 8h/day, 40h/week." Two viable shapes:

| Approach | Pros | Cons |
|---|---|---|
| **A. Block at punch-out** — let them punch in, but force a punch-out at 8h | Catches reality (they punched in for an 8h shift, finishes at 8h regardless of when they remember to punch out) | If they forget to punch out, system auto-closes — weird |
| **B. Block at punch-in** — if punching in would mathematically put them over today's or this-week's cap, refuse | Strict; matches owner's stated requirement | Risks blocking legitimate same-day re-punches (worker took an unpaid lunch and returned) |
| **C. Block at punch-in, with manager override field** (recommended) | Matches owner intent + escape hatch for legit edge cases | One more UI knob |

**Going with C.** Owner sets the cap (default 8/40, configurable per org and overridable per user). On punch-in we sum the user's `duration_minutes` for today and this Mon–Sun week. If `today_minutes + (an open shift would average X min)` ≥ cap, **refuse with a clear error**. Override path: manager can flip `cap_exempt_until` on the user record for an explicit shift.

This also serves as the **compliance gate** for predictive scheduling laws (Oregon statewide, several California cities) — we can layer "must give 14-day notice for shift changes" on top of the same plumbing.

### 3d. Anti-buddy-punching — owner picks the method

Industry consensus from Buddy Punch / Connecteam / Jibble / TimeTrex reviews — listed from highest deterrent to lowest:

1. **Selfie on punch-in/out** — strongest, but workers commonly perceive it as invasive. **Off by default.** Owner can flip on in Settings if they want it.
2. **IP restriction** — punches only accepted from the store's WiFi public IP (or a CIDR range). Zero invasiveness, very effective for in-store workers. Side-effect: blocks legitimate punches from cellular data, which is actually desirable for on-site verification. Doesn't work for offshore 1099s — they're auto-exempt.
3. **PIN at punch** — 4–6 digit code each worker sets at first login. `pin_hash` column already exists in `users` (migration 001). **Honest note:** PIN sharing is the *classic* buddy-punching vector — telling a friend your PIN is trivial. PIN is only meaningfully stronger than nothing when combined with **device pinning** (the PIN must be entered on the user's registered phone, not someone else's), which we wire up alongside.
4. **GPS + geofence** — already shipped.
5. **Device pinning** — clock-in only allowed from a previously-registered device (we have `device_info`).
6. **Biometric (Face/Touch ID)** — deferred until EAS native build; not available in Expo Go.

**Owner-configurable in Settings** — a single multi-select: which methods (any combination of selfie / PIN / IP / device-pinning) are required at punch. All off by default. Geofence enforcement stays separately controllable (already shipped).

Implementation surface:
- `organizations.punch_verification_methods JSONB` (array of `'selfie'|'pin'|'ip'|'device'`)
- `organizations.allowed_punch_cidrs JSONB` (array of CIDR strings, e.g. `["73.42.18.0/24"]`)
- `users.pin_hash` already in schema; just expose set/reset endpoints + UI.
- Mobile + web punch endpoints check the configured methods in order; failure of any required method blocks the punch with a method-specific error.

### 3e. Accounting layer scope

Two surfaces:

**(i) QuickBooks-compatible export.** IIF format (text, hand-buildable) — one journal entry per pay period per employee:
- DR `Labor Expense` (gross wages)
- DR `Payroll Tax Expense` (employer side)
- CR `Wages Payable` (net pay to employee)
- CR `Payroll Tax Liabilities — Federal / State / FICA`
- (For 1099) DR `Contractor Expense` / CR `Accounts Payable` only — no withholding lines.

User downloads `.iif`, opens QuickBooks Desktop → File → Utilities → Import → IIF. Done. QBO has a different (slightly less terrible) JSON Journal Entry import; we'll do both formats.

**(ii) Cost-of-labor widget.** New card on Overview: "This week's labor cost — Scheduled: $X / Actual so far: $Y / Budget: $Z." Pulls from the timesheet endpoint + new org-level budget. Three lines, zero new infra.

## 4. Data model changes (migration 003)

```sql
-- onshore/offshore narration tag
ALTER TYPE user_role …  -- unchanged
CREATE TYPE worker_type AS ENUM ('W2', 'contractor_1099');
CREATE TYPE worksite     AS ENUM ('onshore', 'offshore');

ALTER TABLE users
  ADD COLUMN worker_type    worker_type NOT NULL DEFAULT 'W2',
  ADD COLUMN worksite       worksite    NOT NULL DEFAULT 'onshore',
  ADD COLUMN job_title      VARCHAR(120),           -- for UI; "Cashier", "Bookkeeper"
  ADD COLUMN pay_currency   CHAR(3) NOT NULL DEFAULT 'USD',
  ADD COLUMN cap_exempt_until TIMESTAMPTZ,          -- manager override window
  ADD COLUMN photo_url      TEXT;                   -- selfie reference

-- org-level caps, budget, and feature flags
ALTER TABLE organizations
  ADD COLUMN max_daily_minutes   INT NOT NULL DEFAULT 480,   -- 8h
  ADD COLUMN max_weekly_minutes  INT NOT NULL DEFAULT 2400,  -- 40h
  ADD COLUMN cap_enforcement     TEXT NOT NULL DEFAULT 'block'  CHECK (cap_enforcement IN ('off','warn','block')),
  ADD COLUMN weekly_labor_budget NUMERIC(12,2),               -- nullable
  ADD COLUMN qb_chart_of_accounts JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- feature flags: every v2 feature is opt-in unless noted. Owner toggles in Settings.
  ADD COLUMN feature_cash_drawer           BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN feature_kiosk_qr              BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN feature_predictive_scheduling BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN feature_documents             BOOLEAN NOT NULL DEFAULT TRUE,  -- low-risk, on
  ADD COLUMN feature_time_off              BOOLEAN NOT NULL DEFAULT TRUE,  -- low-risk, on
  ADD COLUMN feature_shift_trades          BOOLEAN NOT NULL DEFAULT TRUE,  -- low-risk, on
  ADD COLUMN feature_push_notifications    BOOLEAN NOT NULL DEFAULT TRUE,  -- low-risk, on
  -- anti-buddy-punching: any subset of ('selfie','pin','ip','device'). Empty = nothing extra beyond geofence.
  ADD COLUMN punch_verification_methods JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN allowed_punch_cidrs        JSONB NOT NULL DEFAULT '[]'::jsonb;

-- time-off requests
CREATE TABLE time_off_requests (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date    DATE NOT NULL,
  end_date      DATE NOT NULL,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by    UUID REFERENCES users(id),
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- shift trade requests
CREATE TABLE shift_trades (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shift_id      UUID NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  from_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','approved','rejected','cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- cash drawer counts (c-store specific)
CREATE TABLE cash_drawer_counts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  time_entry_id UUID REFERENCES time_entries(id) ON DELETE SET NULL,
  count_type    TEXT NOT NULL CHECK (count_type IN ('start','end')),
  expected_cents BIGINT,           -- nullable if no register integration
  counted_cents BIGINT NOT NULL,
  variance_cents BIGINT GENERATED ALWAYS AS (counted_cents - COALESCE(expected_cents, counted_cents)) STORED,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- employee documents (I-9, W-4, certifications)
CREATE TABLE employee_documents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,  -- 'i9', 'w4', 'driver_license', 'food_handler', 'other'
  storage_url   TEXT,
  expires_at    DATE,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS policies for the four new tables (same pattern as time_entries)
```

## 5. RBAC matrix — what each role sees in the UI

| Tab / Action | Owner | Manager | Employee | Viewer |
|---|---|---|---|---|
| Overview | ✓ (all KPIs incl. labor cost) | ✓ (no cost) | ✗ | ✓ (no cost) |
| Clock In/Out | ✓ | ✓ | ✓ | ✗ |
| My Timesheet | ✓ own | ✓ own | ✓ own | ✗ |
| My Schedule | ✓ own | ✓ own | ✓ own | ✗ |
| Time off | ✓ own + approve all | ✓ own + approve all | ✓ own | ✗ |
| Trades | approve | approve | post + accept | ✗ |
| Team | ✓ full | ✓ full read; add but only `employee` role | ✗ | ✓ read |
| Schedule (all) | ✓ edit | ✓ edit | ✗ | ✓ read |
| Timesheets (all) | ✓ | ✓ | ✗ | ✓ read |
| Reports | ✓ | ✓ | ✗ | ✓ |
| Settings | ✓ | ✗ | ✗ | ✗ |
| Audit log | ✓ | ✗ | ✗ | ✗ |
| Documents — own | ✓ | ✓ | ✓ | ✗ |
| Documents — others | ✓ | ✓ read | ✗ | ✗ |

Implementation: a single `permissions.ts` in `@punchclock/shared` exports a `can(role, action)` function. Used by:
- API: a `requirePermission('view:reports')` middleware that supersedes `requireRole`.
- Web: a `<Gate action="view:reports">` component that wraps each nav item.

## 6. API additions

| Method + path | Auth | Description |
|---|---|---|
| `GET  /api/v1/me/timesheet?from=&to=` | any | Current user's own hours |
| `GET  /api/v1/me/schedule?from=&to=` | any | Current user's own shifts |
| `POST /api/v1/me/time-off` | any | Submit a PTO request |
| `GET  /api/v1/me/time-off` | any | List my requests |
| `POST /api/v1/admin/time-off/:id/decision` | manager+ | Approve / reject |
| `POST /api/v1/me/shift-trade` | any | Post a shift for swap |
| `POST /api/v1/me/shift-trade/:id/accept` | any | Pick up an open trade |
| `POST /api/v1/admin/shift-trade/:id/decision` | manager+ | Final manager approval |
| `POST /api/v1/admin/users/:id/photo` | manager+ | Upload selfie reference |
| `POST /api/v1/time-tracking/punch-in/photo` | any | Punch-in with selfie attached |
| `GET  /api/v1/admin/audit-logs?from=&to=&actorId=&action=` | owner | Audit viewer |
| `GET  /api/v1/admin/exports/payroll.iif?from=&to=` | owner | QuickBooks IIF |
| `GET  /api/v1/admin/exports/payroll.qbo.json?from=&to=` | owner | QuickBooks Online |
| `GET  /api/v1/admin/cost-of-labor?from=&to=` | manager+ | Labor cost dashboard data |
| `POST /api/v1/admin/cash-drawer` | any (at-shift-end), manager+ (anytime) | Cash drawer count |

Behavior changes to existing endpoints:
- `POST /api/v1/time-tracking/punch-in` — adds the **cap check** before insert (block if `worker_type='W2'` and would exceed `max_daily_minutes` or `max_weekly_minutes` minus `cap_exempt_until` window). Adds geofence skip for `worksite='offshore'`. Adds `requirePhotoAt: 'punch_in' | 'punch_out'` org setting.
- `GET /api/v1/scheduling/shifts` — already filters to own when role=employee; verify.
- `POST /api/v1/scheduling/shifts` — adds **conflict detection** (overlapping shift; would exceed weekly cap; would violate 10h-between-shifts predictive-scheduling rule).
- `GET /api/v1/admin/timesheets` — splits aggregation by `worker_type` (1099 rows have no OT, no withholding columns).

## 7. UI changes

- `DashboardShell.tsx` — wrap nav items in `<Gate>`, hide ones the current role can't access.
- New routes:
  - `/dashboard/my-timesheet` (employee-visible)
  - `/dashboard/my-schedule` (employee-visible)
  - `/dashboard/time-off` (employee submits; manager approves on same page with role-conditioned UI)
  - `/dashboard/trades` (similar pattern)
  - `/dashboard/audit-log` (owner-only)
  - `/dashboard/documents` (own + admin variants)
- Team page — add columns: Worker type (W-2 / 1099), Worksite (Onshore / Offshore), Job title, Last cap-block.
- Settings — new sections: Hour caps (daily/weekly minutes + enforcement mode), Labor budget, QuickBooks chart-of-accounts mapping, Photo-on-punch requirement.
- Overview — add **Labor cost** card (scheduled / actual / budget, colored red when over budget). Hide from non-owner.
- Schedule modal — show inline warning when shift would exceed cap or overlap. **Save button disabled** for non-managers (UX hint; API enforces).
- Mobile (`packages/mobile/app/clock.tsx`) — add selfie capture step when org `requirePhotoOnPunch=true`.

## 8. Quality bar

Per CLAUDE.md global quality standard:

- Every new endpoint has Jest unit tests in `packages/api/tests/unit/` and is exercised by the existing seed scenario.
- Every new UI page has at least one Vitest happy-path test.
- DB migration 003 has a corresponding `pnpm db:rollback` recipe documented.
- `docs/demo-runbook.md` and `docs/demo-recording-script.md` updated to cover the new flows.
- Seed data extended: 3 employees marked `worker_type=1099`, 4 marked `worksite=offshore`, 2 with active time-off requests, 1 with an open shift trade, 1 cap-block in the audit log.
- README updated with the new permissions matrix.

## 9. Out of scope (explicit deferrals)

- POS integration (Verifone, Gilbarco, Clover) — needs partner API keys.
- Native biometric — needs EAS native build, not Expo Go.
- SMS via Twilio — costs money, push is enough.
- Real payroll processing (pay employees money). We export to QB; QB issues checks.
- Multi-store — schema supports, but UI gating + per-store geofences + per-store labor budgets is its own milestone.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Cap-blocking causes legitimate-work refusal | Manager override field; `cap_enforcement='warn'` per-org switch to soft-launch |
| 1099 misclassification advice could be wrong for specific state | Disclaimer in Settings UI: "Independent contractor classification is a legal determination; consult counsel." |
| QB IIF format drift | Spot-check imports against a real QB Desktop install during M3 of this plan |
| Selfie storage cost on shared hosting | Cap at 500 KB / image, JPEG only, S3-compatible signed URL; no local DB blobs |
| Existing seed data + 23 API + 13 mobile + 3 web tests still need to pass | New tests are additive; regression suite gates each PR |

---

## Sources

- [Homebase vs When I Work 2026 comparison](https://wheniwork.com/blog/homebase-vs-wheniwork)
- [Homebase pricing & alternatives 2026](https://www.stackscored.com/pricing/employee-scheduling/compare/7shifts-vs-homebase/)
- [Deputy compliance review](https://www.performancereviewssoftware.com/software/homebase-review/)
- [Hubstaff time-tracking + buddy punching](https://hubstaff.com/time-tracking/buddy-punching)
- [Buddy Punch product review 2026 (Connecteam)](https://connecteam.com/reviews/buddy-punch/)
- [TimeTrex anti-buddy-punching 2025](https://www.timetrex.com/blog/solutions-to-buddy-punching-in-2025)
- [Predictive scheduling laws 2026 (Paycom)](https://www.paycom.com/resources/blog/predictive-scheduling-laws/)
- [Oregon Fair Workweek + city ordinances (Workforce.com)](https://www.workforce.com/news/predictive-scheduling-laws)
- [QuickBooks IIF import + journal entries (Intuit Community)](https://quickbooks.intuit.com/learn-support/en-us/do-more-with-quickbooks/how-do-i-export-general-journal-entries-in-csv-or-iif-format/00/975182)
