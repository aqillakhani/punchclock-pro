# PunchClock Pro — Demo Runbook

> Internal-use time clock built for one c-store operator with ~50 employees,
> mixed in-store + remote. Self-hosted, no SaaS subscription, no per-seat
> fee. This runbook walks the demo end-to-end so you don't have to
> improvise.

---

## 1. Elevator pitch (~30 seconds, open with this)

> "This is a time clock built for your store. Your in-store team punches
> in from a phone or a tablet at the counter — the system checks they're
> actually at the store using GPS. Your remote bookkeepers punch in from
> wherever they are. You see who's clocked in right now in real time,
> drag-and-drop next week's schedule, and at the end of the pay period
> you export one CSV that goes straight to payroll. No subscription, no
> per-seat fee, runs on your laptop or a $5/mo cloud server."

Adapt as needed. Keep it under 30 seconds.

---

## 2. Pre-demo checklist (do this 15 min before the meeting)

Run these from the project root in this order. Each command should succeed
before moving to the next.

```bash
# A. Make sure Docker is running (Postgres + Redis containers)
docker ps
# Expected: punchclock-postgres and punchclock-redis both "Up ... (healthy)"
# If missing:  pnpm db:up   then wait ~10s for healthy

# B. Re-seed the demo data so dates are fresh
pnpm db:seed
# Expected last line: "demo credentials" with owner@quickstop.test / Demo12345

# C. Start API + Web (use ONE terminal window per service)
pnpm --filter @punchclock/api dev
# Expected: "PunchClock Pro API started" on :4000

pnpm --filter @punchclock/web dev
# Expected: "Ready in ..." on :3000

# D. (Optional) Start the mobile dev server, only if you're demo'ing the phone flow
pnpm --filter @punchclock/mobile start
# Expected: QR code in the terminal + a LAN URL like exp://192.168.1.x:8081
# You will scan that QR with the Expo Go app on your phone.

# E. Quick smoke test in your browser
#   1. Open http://localhost:3000/login
#   2. Sign in as owner@quickstop.test / Demo12345
#   3. You should see "Quick Stop #4" in the sidebar and the Overview cards
#      showing "Clocked in now: 3" and "Total employees: 25"
#   4. Sign out
```

If any step fails, scroll to **§7. Troubleshooting**.

---

## 3. Credentials cheat sheet

All seeded users have password `Demo12345`. Roles you can demo with:

| Email | Name | Role | Notes |
|---|---|---|---|
| `owner@quickstop.test` | Demo Owner | Owner | Full access. Use this for most of the demo. |
| `jordan.kim@quickstop.test` | Jordan Kim | Manager | Store Manager. Use when showing the "Schedule" workflow. |
| `priya.sharma@quickstop.test` | Priya Sharma | Manager | Asst Store Manager. |
| `alex.rivera@quickstop.test` | Alex Rivera | Employee | Shift Lead. Use when showing the worker phone clock-in. |
| `rosa.martinez@quickstop.test` | Rosa Martinez | Employee | Remote bookkeeper. Use when explaining the "geofence off for remote" point. |

Store / org info:
- Store name: **Quick Stop #4**
- Address: 4521 Westheimer Rd, Houston, TX
- Geofence: 120 m radius around `29.7407, -95.4654` (Houston), enforcement = **flag** (records violations, doesn't block)
- Timezone: America/Chicago

---

## 4. Exact demo script

Open the browser to **`http://localhost:3000`** and follow these steps. Total
target run time: 5–7 minutes.

### Step 1 — Login (45 sec)
1. URL bar: `http://localhost:3000` (it auto-redirects to `/login`).
2. Email: `owner@quickstop.test`
3. Password: `Demo12345`
4. Click **Sign in**.

What to say:
> "You log in once. Everything from here is one app — no extra tabs, no
> jumping between QuickBooks and a separate scheduling tool."

### Step 2 — Overview (~45 sec)
You land on **`/dashboard`**. Three cards:
- **Clocked in now: 3** (green)
- **Total employees: 25**
- **Last punch: <time> · Kara Lopez punched in**

What to say:
> "Right now, three people are clocked in. The system pulls this in real
> time from a WebSocket — when someone on your team punches in on their
> phone, this number ticks up live without a refresh."

Optional wow moment: have a second tab/phone do a punch and watch the
counter tick up. Do this if you have a phone connected — see **§5**.

### Step 3 — Team (~45 sec)
Sidebar → **Team**.
- 25 rows: name, email, role badge, status, last login.
- Demonstrate the **Add user** button briefly. Don't add one unless you
  have time — keep moving.

What to say:
> "Adding a new employee is one form. You set an initial password they
> can change later. You can also archive someone — say a cashier leaves —
> and the system keeps all their old timecards for payroll history but
> they can't sign in anymore."

### Step 4 — Schedule (~75 sec) — this is the headline moment
Sidebar → **Schedule**.
- Weekly grid, every employee × every day Mon–Sun.
- Pre-filled with the current week's shifts (87 scheduled).
- Color-coded chips: blue = standard, amber = overtime, purple = double.

What to say:
> "This is next week's coverage. Every box that's blue is a scheduled
> shift. The pluses are empty slots you can click to schedule someone.
> Watch this — say Kara called out for her overnight shift."

Click an empty `+` cell on any row.
- Modal opens: pick an employee, set start/end, type, hit **Add shift**.
- New chip appears in the grid.

Then click the small **×** that appears when hovering a chip to remove
one (only if it looks clean — hover is sometimes hard to demo live).

> "Saved. That worker now has it on their schedule. If you assigned
> overtime, it shows in amber so the manager can rethink before payroll
> hits."

### Step 5 — Timesheets (~60 sec)
Sidebar → **Timesheets**. Header summary cards: total hours, regular, OT,
estimated payroll for the current week.

What to say:
> "This is the current pay week. You can see hours per person per day,
> total hours, who's in overtime, and what payroll looks like before you
> approve. Last week's view is one click — that's your approval workflow.
> Anything in amber needs your eyes."

Click **← Prev** to jump back a week. Cards update, table updates.

### Step 6 — Reports + payroll CSV (~75 sec) — the second headline moment
Sidebar → **Reports**.
- Date range defaults to last 14 days.
- 5 summary cards: total hours, regular, OT, double-time, est. payroll.
- Federal / California overtime selector.
- Preset chips: Last 7 days, Last 14 days, This month, Last 90 days.

What to say:
> "Here's where payroll lives. Pick the pay period — biweekly here. The
> system already split out regular vs. overtime by week using federal
> rules. If you operate in California or need daily double-time, switch
> here." (Toggle to California, watch numbers update.)

Click **⬇ Export CSV** (top right).
- A `payroll_<from>_to_<to>.csv` downloads.
- Open it in Notepad or Excel to show: Employee, Email, Role, Total
  hours, Regular, OT, Double, Pay rate, Estimated pay.

> "That file goes straight into ADP, Gusto, QuickBooks Online — anything
> that imports CSV. Zero manual data entry. Zero math errors."

### Step 7 — Settings + geofence (~45 sec)
Sidebar → **Settings**.
- Organization profile (editable name, timezone).
- Geofencing + break tracking toggles.
- Store locations table: shows Quick Stop #4 at 29.7407, -95.4654, 120 m,
  Flag enforcement.

What to say:
> "Here's the c-store-specific bit. This geofence is a 120-meter circle
> around the store. When someone hits Punch In, the system checks their
> phone GPS against it. Right now it's set to 'Flag' — record a violation
> but allow the punch — that's good for testing. Flip it to 'Block' and
> the punch is rejected unless they're at the store. Remote workers like
> your bookkeeper aren't bound by it — that's why their punches still go
> through wherever they are."

### Step 8 — Live punch from your phone (~45 sec) — the wow finale
**Only do this if you successfully set up step D in §2.**

1. On your phone, open **Expo Go**.
2. Scan the QR code in the `pnpm --filter @punchclock/mobile start`
   terminal.
3. App loads, lands on the Sign in screen.
4. Email: `alex.rivera@quickstop.test`, Password: `Demo12345`, **Sign in**.
5. You're on the clock screen. Status: "Clocked Out".
6. Hand the laptop showing **Overview** to your friend.
7. Tap **Punch In** on your phone.
8. Watch the "Clocked in now" counter on the laptop tick from 3 → 4.

What to say:
> "Alex is a shift lead. He's about to start a shift. He punches in from
> his phone." (tap) "GPS captured, server gets it, your dashboard
> updated live. That's what your manager sees from anywhere."

If mobile isn't set up, **skip this step entirely** — don't apologize, just
finish at Settings and go to Q&A.

---

## 5. Mobile / phone setup (one-time)

You only need this if you want to do the live phone punch in §4 step 8.

### Pre-requisites on your phone
1. Install **Expo Go** from the App Store (iOS) or Play Store (Android).
2. Your phone and your laptop must be on the **same WiFi network**.

### Pre-requisites on your laptop
- Windows Firewall may block incoming connections on port 4000. The
  first time something tries to reach the API from your phone you'll
  get a Windows Defender prompt — click **Allow** for Private networks.

### Starting it
```bash
pnpm --filter @punchclock/mobile start
```

This prints a big QR code in the terminal. On your phone:
- **iOS:** open the Camera app, point at the QR, tap the banner.
- **Android:** open Expo Go, tap "Scan QR code".

The app downloads and opens. First load takes ~30 seconds, after that
it's instant.

### Why this works without configuring an IP
The mobile app reads the laptop's LAN IP from the Metro bundler at boot
and connects the API to `http://<laptop-LAN-IP>:4000` automatically. No
manual config. Source: `packages/mobile/src/services/http-client.ts`.

---

## 6. What this demo intentionally does NOT cover

You'll get asked. Pre-baked answers:

| Question | Answer |
|---|---|
| Does this integrate with QuickBooks / ADP / Gusto? | "Not via API — but the CSV export is in the format every payroll tool accepts. The OAuth integrations are on the roadmap." |
| What about biometric or PIN punch on a kiosk tablet? | "Phase 2 — kiosk mode with PIN and fingerprint is built in the mobile codebase, just not wired into this build. Easy add when you want it." |
| Can workers see their own timesheets / paystubs? | "Not yet — current focus is the manager view. Worker self-service is the next milestone." |
| What about scheduled shift trades, time-off requests? | "Roadmap." |
| Is this multi-store? | "Single store right now. Schema supports it — you'd just create multiple geofences and the same workers across stores." |
| Where does it run? | "Anywhere you can run Docker — your laptop, a $5/mo droplet, an Oracle Cloud Always-Free VM. There's no Stripe, no SaaS lock-in, no per-seat fee." |
| Is the data secure? | "Postgres with row-level security at the database layer, JWT auth, bcrypt password hashing. Self-hosted means you control the data. We can put it behind your own VPN." |
| How much would this cost to run for our 50 employees? | "Hosting: ~$5–20/month depending on the VPS. There is no per-seat license fee. The whole codebase is yours." |

---

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `pnpm db:up` errors | Docker Desktop isn't running. Start Docker Desktop, wait for the whale icon, retry. |
| `pnpm db:migrate` errors with "DATABASE_URL" | `.env` is missing. `cp .env.example .env`. |
| Web shows "Loading…" forever | API isn't running. Check the `pnpm --filter @punchclock/api dev` terminal for errors. |
| Login says "Invalid email or password" | Run `pnpm db:seed` again — the DB may have been wiped. |
| Overview cards show "…" instead of numbers | Wait ~1 second; first load fetches from API. If still empty after 5s, check API terminal. |
| Phone gets "Network request failed" | Check both devices are on the same WiFi. Check Windows Firewall let through port 4000. Restart `pnpm --filter @punchclock/mobile start` to rebuild the QR with the right IP. |
| Black "N" circle in bottom-left of the dashboard | That's Next.js's dev mode segment-explorer indicator. To hide it for a production-quality demo, run `pnpm --filter @punchclock/web build && pnpm --filter @punchclock/web start` instead of `dev`. |
| You accidentally clicked a button you didn't mean to and want to reset | `pnpm db:seed` from another terminal — wipes everything and re-seeds in ~5 seconds. |

---

## 8. After the demo — leave-behind talking points

If your friend says "yes, let's try it":
1. You can host it on their own laptop in their office, a $5/mo VPS
   (Hetzner / DigitalOcean / Vultr), or Oracle Cloud Always-Free.
2. The mobile app needs to be published via EAS for App Store / Play
   Store distribution if they don't want every employee on Expo Go. That's
   a 1-day setup with EAS.
3. Roadmap items in priority order: payroll OAuth integrations,
   worker self-service portal, kiosk PIN mode, multi-store, time-off
   requests, shift trades.

---

## 9. Screenshot reference

Take a peek at `docs/demo-screenshots/` for what every screen should look
like if it's working correctly. If your live demo deviates from these
visually, something's not right — see Troubleshooting.

- `01-login.png` — Sign in page
- `02-overview.png` — Team overview with 3 cards
- `03-team.png` — Team table with 25 rows
- `04-schedule.png` — Weekly schedule grid with shift chips
- `05-timesheets.png` — Per-employee weekly hours table
- `06-reports.png` — Date range payroll summary + table
- `07-settings.png` — Org settings + geofence table
- `08-clock.png` — Browser clock-in screen (alt path if mobile isn't ready)
