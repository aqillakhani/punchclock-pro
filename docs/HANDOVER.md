# PunchClock Pro — Start Here

**This is the only document you need to start using the system.** It is written for
the person taking it over, not for a programmer. Follow it top to bottom.

Everything below was verified against the live system on **11 September 2026**.

---

## The two addresses

| What | Address | Who uses it |
|---|---|---|
| **The app** (everyone) | **https://punchclock-web-lake.vercel.app** | You, your managers, your workers |
| The engine behind it | https://punchclock-api.fly.dev | Nobody, day to day. It just has to be running. |

To check the system is alive at any time, open
<https://punchclock-api.fly.dev/health> in a browser. You want to see the word
`"ok"`. If you see an error page, jump to [When something goes wrong](#8-when-something-goes-wrong).

---

## 1. Sign in for the first time

1. Open **https://punchclock-web-lake.vercel.app** on a computer.
2. You will land on the sign-in page.
3. Enter the owner email and password.

**The owner account is `aqil.lakhani8@gmail.com`.**

The password is **not written in this file on purpose** — this file lives in a code
repository that could be shared. The password is in the separate credentials file you
were given alongside this one (`secrets/HANDOVER-CREDENTIALS.md`). Put it in a password
manager today.

> ### ⚠️ Read this before you change anything
>
> **If you lose the owner password, you are locked out and there is no self-service way back in.**
>
> The "Forgot password?" link on the sign-in page does not work on this system yet.
> It looks like it works — it says *"a reset link is on its way"* — but no email is
> ever sent, because email delivery has never been switched on. The reset link is
> created and immediately thrown away.
>
> Getting back in after that means someone technical connecting directly to the
> database. See [Section 9](#9-for-whoever-looks-after-the-technical-side).
>
> **So: save the owner password in a password manager before you do anything else.**

### The four kinds of user

| Role | What they can do |
|---|---|
| **Owner** | Everything. Settings, payroll export, audit log. There is normally one. |
| **Manager** | Run the day: schedule, timesheets, approve time off and corrections, add employees. Cannot see Settings, payroll export, or the audit log. |
| **Employee** | Clock in/out, see their own hours and schedule, request time off, ask for a correction. |
| **Viewer** | Read-only. Can look at the team, schedule, timesheets and reports. Cannot clock in or change anything. |

---

## 2. Your first hour — set the system up

Sign in as the owner and click **Settings** in the left-hand menu. Work down the page.

### a. Organization
- **Organization name** — your business name. It appears across the app.
- **Default timezone** — **get this right before anyone clocks in.** Every hour
  worked, every overtime calculation and every pay period is worked out in this
  timezone. Changing it later makes past hours look wrong.
- **Break tracking** — turn on if you want workers to punch in and out of their
  breaks. Unpaid breaks are then subtracted from paid time automatically.

### b. Store locations (geofences) — optional
This is the "workers can only clock in at the shop" feature.

**Right now no location is set up, which means punches are accepted from anywhere.**
That is a working, sensible default — nobody is blocked. If you want location
enforcement, add your store here with its address radius. If you do not care, skip it;
nothing breaks.

### c. Punch verification — optional
Anti-buddy-punching options (PIN at punch, selfie, store IP restriction, device
pinning). **All are off by default.** Turn them on only if you actually need them —
each one adds friction for every worker, every shift.

### d. Compliance and budget — optional
Weekly labour budget (shows on the Overview page) and 14-day predictive-scheduling
notice. Leave alone unless you need them.

**Save the page when you are done.**

---

## 3. Add your first worker

Email is not switched on, so **the system cannot send the invitation for you.
You copy a link and send it yourself** — by text, WhatsApp, or handing them a phone.
This is a normal, supported flow, not a workaround failing.

1. Click **Team** in the left menu.
2. Click to add a person. Fill in their name, email and role (usually *Employee*).
3. **Leave the password field blank.**
4. Press save. A panel appears with a **sign-in link and a Copy button**.
5. **Copy that link and send it to the worker.** This is the only time it is shown.
6. The worker opens the link on their phone, picks their own password, and is in.

**The link is valid for 7 days.**

### If you lose the link, or it expires
Go to **Team**, find the person — they will show a **"No password set"** badge —
and click **"Get sign-in link"**. That generates a fresh one. Send it the same way.

> If someone *already has* a working password, that button is deliberately refused —
> it would wipe a password they are using. There is no way to send them a reset link
> until email is switched on, so they need to remember it.

---

## 4. How workers clock in and out

**Workers use the website in their phone's browser.** There is no app to install —
see [Section 8](#what-is-not-finished) for why.

Tell each worker to do this once:

1. Open **https://punchclock-web-lake.vercel.app** in their phone browser.
2. Sign in with their email and the password they chose.
3. **Add it to their home screen** so it opens like an app:
   - **iPhone (Safari):** tap the Share button → *Add to Home Screen*.
   - **Android (Chrome):** tap the ⋮ menu → *Add to Home screen*.

Then, every shift:

1. Tap the icon, tap **Clock In/Out** in the menu.
2. Tap the big **Punch In** button. The same button becomes **Punch Out** at the end
   of the shift.
3. If break tracking is on, break buttons appear while they are clocked in.

**About location:** the page asks for location permission. If the worker declines, or
their GPS is slow, **the punch still goes through** — it waits about 5 seconds, then
records the punch without a location. Nobody gets stuck.

> ### The one thing to warn workers about
> **Always punch out.** The system allows only one open shift per person, and there
> is currently no automatic close-out. If someone forgets to punch out, **they cannot
> punch in for their next shift** until it is fixed.
>
> Fix it yourself: **Timesheets** → find the entry → edit it and set the correct
> punch-out time (you must give a reason; it is recorded).
>
> The permanent fix for this is built and tested but not yet switched on in
> production — see [Section 8](#what-is-not-finished).

---

## 5. Your day to day

| I want to… | Go to | Notes |
|---|---|---|
| See who is on the clock right now | **Overview** | Updates live. Labour-cost card is owner-only. |
| See everyone's hours | **Timesheets** | Whole team, by date range. |
| See my own hours | **My Timesheet** | Every user has this. |
| Fix a wrong punch | **Timesheets** → edit the entry | Reason required. The original is never erased — it is kept alongside the change. |
| Handle a worker's request to fix their hours | **Corrections** | They file it, you approve, reject, or approve with different times. A badge shows how many are waiting. |
| Approve holiday / time off | **Time off** | Requests from workers land here. |
| Build next week's rota | **Schedule** | Add and delete shifts; it warns you about clashes. |
| Let workers swap shifts | **Trades** | A worker posts a shift, another picks it up, a manager approves the swap. |
| Store an I-9, W-4, licence | **Documents** | Has expiry tracking. |
| See who changed what | **Audit log** | Owner only. Every significant change, with who and when. |
| Check what a worker sees | **Preview as…** | Owner only. View the app as that person, then Exit. |

---

## 6. Payday

1. Go to **Reports**.
2. Set the **date range** for the pay period.
3. Pick the **overtime rules** — Federal, or California (California adds daily
   overtime and double-time).
4. Check the numbers on screen: hours, overtime, estimated pay, per person.
5. Download:
   - **CSV** — opens in Excel or Google Sheets. Available to owners and managers.
   - **IIF** and **QBO** — for QuickBooks. **Owner only.**

Unpaid breaks are already subtracted — an 8-hour shift with a 30-minute unpaid lunch
exports as 7.5 paid hours.

> **Note:** "Lock the pay period" (so nobody can quietly change hours after you have
> paid them) is built and tested but **not switched on in production yet**. Until it
> is, an approved correction *can* alter a period you have already paid. Until then,
> keep your exported CSV as the record of what you actually paid.

---

## 7. Quick reference — the whole menu

Workers only see what their role allows, so their menu is shorter than yours.

| Menu item | Owner | Manager | Employee | Viewer |
|---|:-:|:-:|:-:|:-:|
| Overview | ✓ | ✓ | — | ✓ |
| Clock In/Out | ✓ | ✓ | ✓ | — |
| My Timesheet / My Schedule | ✓ | ✓ | ✓ | — |
| Time off | ✓ | ✓ | ✓ | — |
| Trades | ✓ | ✓ | ✓ | — |
| Corrections | ✓ | ✓ | ✓ | — |
| Documents | ✓ | ✓ | ✓ | — |
| Team | ✓ | ✓ | — | ✓ |
| Schedule | ✓ | ✓ | — | ✓ |
| Timesheets | ✓ | ✓ | — | ✓ |
| Reports | ✓ | ✓ | — | ✓ |
| Payroll export (IIF/QBO) | ✓ | — | — | — |
| Audit log | ✓ | — | — | — |
| Settings | ✓ | — | — | — |
| Preview as… | ✓ | — | — | — |

---

## 8. When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| A worker cannot punch in — says they already have an open shift | They forgot to punch out | **Timesheets** → find the open entry → edit and set the correct punch-out time |
| A worker never got their invitation | Email is off; the link has to be sent by hand | **Team** → **"Get sign-in link"** → copy it → send it yourself |
| The invite link says expired | Links last 7 days | **Team** → **"Get sign-in link"** for a fresh one |
| A worker forgot their password | "Forgot password" does not work yet | Someone technical must reset it in the database — [Section 9](#9-for-whoever-looks-after-the-technical-side) |
| **You** forgot the owner password | Same — no self-service recovery | Same. This is why the password belongs in a password manager. |
| The whole site is down / spinning | The engine may have stopped | Open <https://punchclock-api.fly.dev/health>. If it is not `"ok"`, [Section 9](#9-for-whoever-looks-after-the-technical-side) |
| Hours look wrong by exactly a few hours | The timezone is probably wrong | **Settings → Default timezone**. Fix it, then check a recent shift |
| A punch has no location on it | The worker declined GPS, or it timed out | Expected behaviour. The punch is still valid |
| Someone is clocking in from the wrong place | No store location is configured yet | **Settings → Store locations** to add one |

### What is not finished

An honest list. None of these stop you using the system today, but you should know
about them before you rely on it.

1. **No phone app.** The mobile app is written but has never been packaged for the App
   Store or Play Store. Workers use the website in their phone browser instead
   (Section 4), which works well. Building and publishing the app is days of work.
2. **Email is switched off.** No invitations, no password resets, no notifications are
   ever delivered. Everything that would be emailed has to be copied and sent by hand.
   Switching it on needs a Resend account and a verified sending domain.
3. **No password recovery.** Follows from #2. Guard the owner password.
4. **No automatic close-out for forgotten punches.** Built, tested, and waiting to be
   switched on. Until then a forgotten punch-out blocks that worker's next shift.
5. **Pay periods cannot be locked yet.** Same batch of work. Until it ships, hours can
   in principle be changed after you have paid them.
6. **Backups are thin.** The database is snapshotted daily and kept for **5 days
   only**, there is no copy stored anywhere else, and the restore procedure has never
   been rehearsed. If something went wrong and was not noticed for a week, the data is
   gone.
7. **Nothing alerts anyone if it goes down.** There is no monitoring. You would find
   out when a worker cannot clock in.
8. **The master passwords exist in one place only** — a single file on the original
   developer's laptop. They cannot be read back out of the hosting provider. If that
   file is lost, the system cannot be maintained.
9. **Old data is kept forever.** GPS locations and pay rates are never deleted, and
   there is no retention policy. Worth a look if you have privacy obligations.

Items 4, 5 and the automatic clean-up of old audit records are all finished code
sitting in a reviewed, tested pull request (**PR #4**) that has not been deployed.
Deploying it is a short job for whoever handles the technical side.

---

## 9. For whoever looks after the technical side

Hand this section to a developer. The rest of the document does not require one.

### Where it runs
| Piece | Where | Name |
|---|---|---|
| API | Fly.io, region `ord` | app `punchclock-api` |
| Database | Fly.io — self-hosted Postgres 16 + TimescaleDB + PostGIS | app `punchclock-db`, volume `pcp_db_data` |
| Web | Vercel, team `orange-panda` (account `ikeshwani-1172`) | project `punchclock-web` |
| Code | GitHub | `aqillakhani/punchclock-pro` |

Running cost is small — a single Fly machine plus a 3 GB volume, with Vercel on the
free tier. **Confirm the real figure on the Fly and Vercel billing pages and move the
payment method to whoever owns it now.**

### Things a developer needs to know immediately

- **The database is not Neon or Supabase and cannot be.** The schema needs the
  `timescaledb` extension, which neither supports. It is self-hosted on Fly. Config is
  in `deploy/db/`.
- **Do not put `sslmode` in `DATABASE_URL`.** Recent `pg` treats `sslmode=require` as
  `verify-full` and rejects the self-signed certificate. TLS is driven by
  `DATABASE_SSL=true` instead.
- **The API connects as `punchclock_app`, deliberately not a superuser.** Tenant
  isolation is enforced by Postgres row-level security, which a superuser silently
  bypasses. Never point the app at the owner role.
- **`packages/api/fly.toml` says `EMAIL_PROVIDER = "resend"` — ignore it.** A Fly
  *secret* of the same name overrides it, and there is no `RESEND_API_KEY`. Mail is
  off. Do not reason about email from that file.
- Redis is genuinely optional on a single machine. `"redis":"disabled"` in the health
  check is correct, not a fault.

### Reaching the database
```bash
flyctl auth login                            # once
flyctl proxy 15432:5432 -a punchclock-db     # leave running in one terminal
# then connect to localhost:15432 as user punchclock — no sslmode in the URL
```
`flyctl postgres connect` does **not** work here — `punchclock-db` is a self-hosted
container, not Fly Managed Postgres.

### Resetting a forgotten password
There is no API path. Write a bcrypt hash at **12 rounds** (must match `BCRYPT_ROUNDS`
in `packages/api/src/config/env.ts`) into `users.password_hash` over the proxy above.

```sql
SELECT email, role, password_hash IS NOT NULL AS has_password, last_login_at
FROM users WHERE deleted_at IS NULL;
```

### Deploying the outstanding work (PR #4)
Branch `feat/pay-periods-auto-clockout` is three commits ahead of `main` and green in
CI. It contains pay-period locking, auto clock-out, the job scheduler (which also runs
audit-log pruning), and a mobile fix that stops punches being lost offline.

**Order matters — migration first, or every punch breaks:**
```bash
# 1. apply migration 008 over the proxy, THEN
flyctl deploy . --remote-only \
  --config packages/api/fly.toml \
  --dockerfile packages/api/Dockerfile \
  --env APP_VERSION=$(git rev-parse --short HEAD)
```
Fly prints a spurious *"app is not listening on the expected address"* during rollout;
it checks before Node finishes booting. Confirm with `/health`, not with that warning.

Web deploys itself from `main` via Vercel's Git integration.

### Repository map
| Document | Covers |
|---|---|
| `GETTING_STARTED.md` | Running the whole stack on a laptop |
| `docs/deploy.md` | Full deployment and operations runbook |
| `docs/permissions.md` | The complete role/permission matrix |
| `docs/onboarding-workers.md` | The invite-link flow in depth, and how to switch email on |
| `docs/time-corrections.md` | How the correction workflow behaves |
| `docs/pay-periods-and-auto-clock-out.md` | The undeployed PR #4 features |
| `docs/security-rls-bypass.md` | History of the tenant-isolation fix |

### Recommended before you rely on this

1. Put every credential in a shared password manager. Today.
2. Deploy PR #4 (above) — it closes the forgotten-punch trap and a real data-loss bug.
3. Point an uptime monitor at `https://punchclock-api.fly.dev/health` with alerts to a
   real phone.
4. Add a nightly `pg_dump` to off-box storage, then **actually rehearse a restore.**
   Five days of snapshots with an untested procedure is not a backup.
5. Switch on email (Resend account + verified domain), which fixes invitations and
   password recovery in one go.
6. Rotate `JWT_SECRET` and the database password once the handover is complete, so the
   previous holder's copies stop being live credentials.

---

## Health check — the system is working if all of these are true

- [ ] <https://punchclock-api.fly.dev/health> shows `"ok"`
- [ ] You can sign in as the owner
- [ ] The owner password is saved in a password manager
- [ ] Organization name and timezone are correct in Settings
- [ ] You added one test worker and the sign-in link worked for them
- [ ] That worker punched in and out from their phone browser
- [ ] Their shift shows up under Timesheets with the right hours
- [ ] You exported a CSV from Reports and the numbers look right
- [ ] You know what to do when someone forgets to punch out (Section 8)
- [ ] Someone technical has read Section 9
