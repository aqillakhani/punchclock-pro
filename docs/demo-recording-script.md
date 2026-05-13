# PunchClock Pro — Demo Recording Script

> A neutral "this is how it works" walkthrough. No sales pitch. ~4 min web
> only, ~5 min with the optional phone segment. Each scene is one action +
> one or two sentences of plain narration.

---

## Before you hit record (5 min)

1. **Refresh the seeded data so the dates are current:**
   ```
   pnpm db:seed
   ```
   Expected last line: `demo credentials` with `owner@quickstop.test` / `Demo12345`.

2. **Run the web in production mode** so the small black "N" dev indicator
   doesn't show in the corner during recording:
   ```
   pnpm --filter @punchclock/web build
   pnpm --filter @punchclock/web start
   ```
   Web is now served from `http://localhost:3000` without the devtools chrome.

   Keep the API in dev:
   ```
   pnpm --filter @punchclock/api dev
   ```

3. **(Optional, only if including the phone segment)** Start the mobile
   dev server in a separate terminal:
   ```
   pnpm --filter @punchclock/mobile start
   ```
   On your phone open Expo Go, scan the QR. Log in as
   `alex.rivera@quickstop.test` / `Demo12345`. Get the phone to the Clock
   screen, status "Clocked Out". Set the phone aside.

4. **Browser prep:**
   - Resize the window to ~1440×900 (close to 16:9).
   - Hide bookmarks bar (`Ctrl+Shift+B`).
   - Close other tabs and any extension popups.
   - Open `http://localhost:3000/login`. **Don't log in yet** — recording
     starts on the login page.

5. **System prep:**
   - Windows → Action Center → toggle **Do not disturb** so notifications
     don't pop in.
   - Close Slack/Teams/email/anything that makes sound.
   - Plug in a headset/mic if you have one — laptop mics catch keyboard
     noise.

6. **Recording tool:** press **Win+G** for the built-in Xbox Game Bar →
   click the round Record button. Use OBS / ScreenPal / Loom if you
   prefer those. Make sure the mic is on and the system audio is on (so
   button clicks etc. record too if you want them).

---

## Pacing rules

- Pause **1–2 seconds** after every click before you speak. The viewer
  needs time to see the page change.
- Move the cursor deliberately — don't wiggle it.
- If you mess up a line, **don't stop**. Pause, restart the sentence
  cleanly. Edit out the bad take later.

---

## Script

Each scene shows the action you take and a sample narration. Read it
verbatim or paraphrase. Times are approximate.

### Scene 1 · Sign in (~10s)
- **Action:** type `owner@quickstop.test`, tab to password, type
  `Demo12345`, click **Sign in**.
- **Narration:** "I'm signing in as the store owner."

### Scene 2 · Overview (~20s)
- **Action:** wait for the dashboard to load. Pause on the three cards.
- **Narration:** "This is the team overview. It shows the number of
  people currently clocked in, the total active employees, and the most
  recent punch in real time."

### Scene 3 · Team (~25s)
- **Action:** click **Team** in the sidebar. Pause so the full table is
  visible. Scroll once if needed. Click **Add user** to show the form.
  Click **Cancel** to close it.
- **Narration:** "Here's the full team — twenty-five employees with
  their role and status. To add a new one, you click Add user and fill
  in the form."

### Scene 4 · Schedule (~35s)
- **Action:** click **Schedule** in the sidebar. Pause on the grid.
  Click a `+` cell on any empty day for any employee. In the modal,
  leave the defaults (employee, date, 9:00–17:00, standard), click
  **Add shift**. The new chip appears in the grid.
- **Narration:** "This is the weekly schedule — every employee across
  Monday to Sunday. Each blue chip is a scheduled shift. To add one,
  click a plus cell, pick the employee and time, and save."

### Scene 5 · Timesheets (~25s)
- **Action:** click **Timesheets** in the sidebar. Pause on the summary
  cards. Click **← Prev** once to show last week.
- **Narration:** "Timesheets show hours per employee per day, plus
  weekly totals. Overtime hours are flagged in amber. Previous and next
  navigate between weeks."

### Scene 6 · Reports + CSV export (~40s)
- **Action:** click **Reports** in the sidebar. Pause on the summary
  cards. Click the **Last 14 days** preset (if not already selected).
  Change the overtime selector to **California** then back to
  **Federal**. Click **⬇ Export CSV**.
- **Narration:** "Reports give a date-range summary by employee. The
  overtime rules can be set to federal or California. Export CSV
  downloads a file with each employee's hours, regular vs overtime
  split, and estimated pay."
- **(Optional)** Open the downloaded CSV in Notepad or Excel for 3
  seconds, then close it.
- **Narration:** "The CSV contains one row per employee."

### Scene 7 · Settings (~30s)
- **Action:** click **Settings** in the sidebar. Pause on the
  Organization card. Toggle **Geofencing enforcement** off and back on.
  Scroll down to the Store locations table.
- **Narration:** "Settings has the organization profile, timezone,
  tracking rules, and the store locations used for geofencing. Each
  location has coordinates, a radius, and an enforcement level — flag,
  override, or block."

### Scene 8 · Clock In/Out from the browser (~20s)
- **Action:** click **Clock In/Out** in the sidebar. Status shows
  "Clocked Out". Click **Punch In**. Status switches to "Clocked In".
- **Narration:** "Anyone can punch in from the web. Status updates
  immediately."

### Scene 9 · (Optional) Live punch from the phone (~45s)
**Skip if your phone isn't set up.**

- **Action:** go back to **Overview** in the sidebar. Note the
  "Clocked in now" number — it should be 4 after the previous scene
  (3 from the seed + you).
- **Narration:** "Back on Overview, the count just went up to four."
- **Action:** show the phone (point your webcam at it, or hold it in
  frame). The phone is on the Clock screen as Alex Rivera. Tap
  **Punch In**. Phone status changes to "Clocked In".
- **Narration:** "On the phone, Alex Rivera taps Punch In."
- **Action:** turn back to the laptop screen showing the Overview. The
  "Clocked in now" number ticks from 4 → 5 within a second.
- **Narration:** "The dashboard updates live — no refresh."

### Scene 10 · Sign out (~5s)
- **Action:** click the **Sign out** button at the bottom of the
  sidebar.
- **Narration:** "Sign out, back at the login screen."

**Stop recording.**

---

## After recording

- Trim any dead space at the start and end.
- Listen back at 1× speed. If you stumbled on a take, you don't have to
  re-record the whole thing — most screen recorders let you cut the bad
  section and stitch.
- Export at 1080p, MP4. That plays on anything.

---

## Things to NOT do on camera

- Don't click any sidebar item you didn't plan to — every page is built
  out, but the script is paced around the 7 you'll visit.
- Don't open browser DevTools (F12).
- Don't toggle the Settings save without filling things out first
  (clicking Save with no changes is a non-action).
- Don't try to edit/delete the seeded geofence — if you accidentally
  delete it, you'll need to re-seed or re-add it during recording.
- If the dashboard shows "…" placeholders, wait 1–2 seconds before
  moving on — the data is loading, not broken.
