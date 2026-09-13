# PunchClock Pro — Start Here

**This is the only document you need to start using the system.** It is written for
the person taking it over, not for a programmer. Follow it top to bottom.

Everything below was verified against the live system on **13 September 2026** — by
signing in and using it, not by reading the code. See
[What has actually been tested](#what-has-actually-been-tested).

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

## Fix these four things first

Found by testing the live system on 13 September 2026. None takes more than a
few minutes, and the first two will look wrong to anyone you hand this to.

1. **Your organization is called "pretty robes."** It is left over from an early
   test and shows at the top of every screen. Rename it in
   **Settings → Organization name**.
2. **The timezone is `America/Chicago`.** If that is not where your staff work,
   change it in **Settings → Default timezone** *before* anyone clocks in —
   every hour, overtime total and pay period is calculated in it.
3. **The owner account has a shift left open since 21 July 2026.** Until it is
   closed, that account cannot punch in. Go to **Timesheets**, find the open
   entry, edit it and set a punch-out time.
4. **`notreal@gmail.com` is a leftover test employee with no password.** Either
   delete it from **Team**, or send it a sign-in link if you want to keep it.

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
> **Always punch out.** The system allows only one open shift per person. If someone
> forgets to punch out, **they cannot punch in for their next shift** until it is fixed.
>
> Fix it yourself: **Timesheets** → find the entry → edit it and set the correct
> punch-out time (you must give a reason; it is recorded).
>
> **The automatic safety net is now deployed but switched off.** A job runs every hour
> looking for shifts left open too long. It does nothing until you choose a cut-off in
> **Settings → Payroll & shifts → Clock-out after (hours)**. Pick something safely
> longer than your longest real shift — 12 or 16 hours suits most businesses.
>
> When it fires, it closes the shift at **punch-in plus your cut-off**, not at the
> moment it noticed — so the hours are predictable and the same every time. Closed
> shifts are flagged, and the worker can file a correction if the time is wrong.
>
> **Turning it on changes what people get paid, so it is deliberately your decision,
> not a default.**

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

### Lock the period once you have paid it

Locking a pay period stops anyone quietly changing hours you have already paid out.
Go to **Pay periods**, find the period you just ran, and lock it.

- Locking blocks **retroactive** changes only — corrections, and manager edits to past
  entries. **It never stops anyone clocking in.** Trapping a worker off the clock
  would be worse than the problem it solves.
- Rejecting a correction is still allowed while locked, because it changes no hours.
- Only an **owner** can unlock, and unlocking **requires a written reason**, which goes
  into the audit log.

Set your payroll calendar first in **Settings → Payroll & shifts**: weekly, fortnightly,
twice-monthly or monthly, plus the date your first period starts.

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
4. **Automatic close-out is deployed but off.** You must choose a cut-off in
   **Settings → Payroll & shifts** before it does anything, because turning it on
   changes what people get paid. Until you do, a forgotten punch-out still blocks that
   worker's next shift.
5. **Pay-period locking is deployed but unused.** Nothing is locked until you lock it
   after each payroll run.
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

Items 4 and 5, plus automatic clean-up of old audit records, were **deployed to the API
on 13 September 2026** (version `9a83921`, database migration 008). The hourly and daily
background jobs are confirmed running. Both features are inert until you configure them,
which is intentional — see Sections 4 and 6.

**One step is still outstanding:** the matching screens (**Pay periods**, and the new
Payroll & shifts block in **Settings**) only appear once PR #4 is merged on GitHub,
which redeploys the website. Until then the API supports both features but there is no
button to press. See Section 9.

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

### State of the API deploy (13 September 2026)

**Done and verified in production:**

- Migration 008 applied. `schema_migrations` now ends at
  `008_pay_periods_and_auto_clock_out.sql`; `pay_periods` exists with RLS enabled *and*
  forced, and `punchclock_app` picked up its grants automatically through the
  `ALTER DEFAULT PRIVILEGES` in `create-app-role.ts` — no manual GRANT needed.
- API deployed at `APP_VERSION=9a83921`. `/health` →
  `{"status":"ok","version":"9a83921","db":"up","redis":"disabled"}`.
- Scheduler confirmed in the logs: `auto-clock-out` every 3,600,000 ms,
  `prune-audit-logs` every 86,400,000 ms.

**Still outstanding — needs push access to `aqillakhani/punchclock-pro`:**

PR #4 is green, mergeable and clean, but **not merged**. `main` therefore does not yet
contain the deployed code, which matters for two reasons: the website is still built
from the old `main` (so the new screens are missing), and **anyone redeploying from
`main` today would roll the API backwards**. Merge it, and Vercel rebuilds the web on
its own.

The deploy command, for next time — **migration first, or every punch breaks**:

```bash
# 1. flyctl proxy 15432:5432 -a punchclock-db   (leave running)
# 2. OWNER_DATABASE_URL=... pnpm --filter @punchclock/api db:migrate
# 3. then, and only then:
flyctl deploy . --remote-only \
  --config packages/api/fly.toml \
  --dockerfile packages/api/Dockerfile \
  --env APP_VERSION=$(git rev-parse --short HEAD)
```

Fly prints a spurious *"app is not listening on the expected address"* during rollout;
it checks before Node finishes booting. Confirm with `/health`, not with that warning.

If `flyctl` reports no access token, the one cached at `~/.fly/config.yml` still works —
export it as `FLY_API_TOKEN` rather than re-running `flyctl auth login`.

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
2. **Merge PR #4** so `main` matches what is deployed and the web picks up the new
   screens. Until then a redeploy from `main` silently rolls the API back.
3. Point an uptime monitor at `https://punchclock-api.fly.dev/health` with alerts to a
   real phone.
4. Add a nightly `pg_dump` to off-box storage, then **actually rehearse a restore.**
   Five days of snapshots with an untested procedure is not a backup.
5. Switch on email (Resend account + verified domain), which fixes invitations and
   password recovery in one go.
6. Rotate `JWT_SECRET` and the database password once the handover is complete, so the
   previous holder's copies stop being live credentials.

---

## What has actually been tested

Not "it should work" — this was driven in a real browser against the live
system on 13 September 2026, signing in as an owner, an employee and a
read-only viewer.

**Confirmed working end to end:**

- Signing in, and signing out
- Punching in and out — a real shift was created, closed, and appeared on the
  timesheet with the correct hours
- Adding a worker, copying the sign-in link, the worker setting their own
  password and signing in **on a phone** — the whole onboarding path
- A worker asking for a time correction, and an owner approving it. An owner
  cannot approve their own request; the system requires a second person
- Requesting time off
- Creating a shift on the schedule
- Downloading payroll as CSV and as QuickBooks `.iif`
- All 16 screens load with no errors, and the role restrictions hold
- Timezone handling is correct (09:00 Chicago is stored as 14:00 UTC)

**Found and fixed during that testing** — seven permission holes in the API,
each confirmed against the live system and re-tested afterwards:

- A read-only **viewer could clock in** and create payroll hours
- The mobile sync endpoint was a second way to do the same thing
- An **employee could read every colleague's punches, GPS locations and breaks**
- An employee could read any colleague's schedule
- Any signed-in user could read your labour budget, punch-verification settings
  and **exact store coordinates**

All seven are closed and covered by tests so they cannot come back quietly.
Nobody could ever *change* anything they shouldn't — these were all about
reading, except the viewer clock-in.

**Not yet testable:** pay-period locking and auto clock-out have no screens
until pull request #4 is merged (Section 9). The engine behind them is live and
tested.

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
