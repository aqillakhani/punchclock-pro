# PunchClock Pro — RBAC matrix

Source of truth: `packages/shared/src/permissions.ts`. Everything below mirrors the `can(role, action)` table that the API middleware (`requirePermission`) and the web sidebar (`<Gate>` / `visibleNavFor`) consult on every request.

If two surfaces ever disagree, the matrix wins. Run `pnpm --filter @punchclock/api test -- permissions` to enforce it.

## The grid

| Action | Owner | Manager | Employee | Viewer |
|---|:-:|:-:|:-:|:-:|
| `view:overview` — Overview tab | ✓ | ✓ | ✗ | ✓ |
| `view:overview.cost` — Labor cost card | ✓ | ✗ | ✗ | ✗ |
| `punch:clock` — Clock In / Out screen | ✓ | ✓ | ✓ | ✗ |
| `view:my-timesheet` — own hours page | ✓ | ✓ | ✓ | ✗ |
| `view:my-schedule` — own shifts page | ✓ | ✓ | ✓ | ✗ |
| `view:time-off` — Time off page | ✓ | ✓ | ✓ | ✗ |
| `submit:time-off` — file a PTO request | ✓ | ✓ | ✓ | ✗ |
| `approve:time-off` — approve / reject queue | ✓ | ✓ | ✗ | ✗ |
| `view:trades` — Shift trades page | ✓ | ✓ | ✓ | ✗ |
| `post:trade` — post a shift for trade | ✓ | ✓ | ✓ | ✗ |
| `accept:trade` — pick up an open trade | ✓ | ✓ | ✓ | ✗ |
| `approve:trade` — final manager swap | ✓ | ✓ | ✗ | ✗ |
| `view:team` — Team page | ✓ | ✓ | ✗ | ✓ |
| `invite:user` — invite new user (manager limited to `employee` role) | ✓ | ✓ | ✗ | ✗ |
| `delete:user` — archive user + reset PIN | ✓ | ✗ | ✗ | ✗ |
| `view:schedule` — full Schedule grid | ✓ | ✓ | ✗ | ✓ |
| `edit:schedule` — add / delete shifts, copy week | ✓ | ✓ | ✗ | ✗ |
| `view:timesheets` — org-wide Timesheets | ✓ | ✓ | ✗ | ✓ |
| `view:reports` — Reports page | ✓ | ✓ | ✗ | ✓ |
| `export:payroll` — IIF / QBO downloads | ✓ | ✗ | ✗ | ✗ |
| `view:settings` — Settings tab | ✓ | ✗ | ✗ | ✗ |
| `edit:settings` — write to Settings | ✓ | ✗ | ✗ | ✗ |
| `view:audit-log` — Audit log viewer | ✓ | ✗ | ✗ | ✗ |
| `view:documents.own` — own documents | ✓ | ✓ | ✓ | ✗ |
| `upload:documents.own` — add a document | ✓ | ✓ | ✓ | ✗ |
| `view:documents.others` — team documents + verify | ✓ | ✓ | ✗ | ✗ |
| `edit:geofence` — store-locations CRUD | ✓ | ✓ | ✗ | ✗ |
| `preview:as-user` — render dashboard as another user | ✓ | ✗ | ✗ | ✗ |

## Sidebar map

| Tab | Action it requires | Roles that see it |
|---|---|---|
| Overview | `view:overview` | owner / manager / viewer |
| Clock In/Out | `punch:clock` | owner / manager / employee |
| My Timesheet | `view:my-timesheet` | owner / manager / employee |
| My Schedule | `view:my-schedule` | owner / manager / employee |
| Time off | `view:time-off` | owner / manager / employee |
| Trades | `view:trades` | owner / manager / employee |
| Documents | `view:documents.own` | owner / manager / employee |
| Team | `view:team` | owner / manager / viewer |
| Schedule | `view:schedule` | owner / manager / viewer |
| Timesheets | `view:timesheets` | owner / manager / viewer |
| Reports | `view:reports` | owner / manager / viewer |
| Audit log | `view:audit-log` | owner |
| Preview as… | `preview:as-user` | owner |
| Settings | `view:settings` | owner |

## Manager guard-rails

A manager has `invite:user` but the route handler explicitly refuses anything other than `role=employee` for them. Owners can invite owners, managers, employees, or viewers. The matrix gate is "may you invite someone"; the role-of-the-invitee restriction is route-level.

Same shape for `delete:user` / `view:settings` / `view:audit-log` / `export:payroll` / `preview:as-user` / `view:overview.cost` — the matrix simply doesn't grant any of these to managers, so the sidebar hides them, the API returns 403, and the front-end gates each card.

## Special owner override: preview-as-worker

When the owner sets `localStorage.pc_preview_as_user_id`, every API request carries `X-Preview-As-User-Id: <uuid>`. `requireAuth` notices the header on owner-only sessions and stashes the id; `withTenantDb` swaps `req.user` for the previewed identity (same org, looked up live). Every downstream gate — `requirePermission`, `/auth/me`, sidebar — sees the previewed identity automatically. The sticky banner across the top reminds the owner they're previewing and offers an Exit button that clears the key + invalidates every React Query cache.

Anything other than the actual JWT being an owner = the header is silently ignored. There is no path to escalate via this header.
