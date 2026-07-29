/**
 * Browser end-to-end check for the time-correction workflow.
 *
 * Drives a real Chromium through the whole loop a business actually
 * performs:
 *   employee logs in → sees an individual punch on My Timesheet
 *   → requests a fix with a reason
 *   → manager logs in → sees it in the approval queue with the diff
 *   → approves → employee's payable hours change
 *
 * The API integration suite proves the endpoints; this proves the
 * screens are wired to them and a human can actually complete the task.
 *
 * Usage (with the local stack running):
 *   node tools/e2e-corrections.mjs
 *   WEB_URL=... API_URL=... node tools/e2e-corrections.mjs
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:4000';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Demo12345';
const EMPLOYEE = process.env.EMPLOYEE_EMAIL ?? 'marcus.chen@quickstop.test';
const MANAGER = process.env.MANAGER_EMAIL ?? 'owner@quickstop.test';

const steps = [];
function record(name, ok, detail = '') {
  steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function login(page, email) {
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 30_000 }),
    page.click('button[type="submit"]'),
  ]);
}

/** Seed a completed shift for the employee so there is something to fix. */
async function seedShift(email) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: MANAGER, password: PASSWORD }),
  });
  const body = await res.json();
  const token = body?.data?.token;
  if (!token) throw new Error(`manager login failed: ${JSON.stringify(body).slice(0, 200)}`);

  const users = await (
    await fetch(`${API}/api/v1/admin/users`, { headers: { authorization: `Bearer ${token}` } })
  ).json();
  const target = (users.data ?? []).find((u) => u.email === email);
  if (!target) throw new Error(`employee ${email} not found in seeded org`);

  // Yesterday 09:00 → 17:00 UTC, created through the manual-entry API.
  const day = new Date();
  day.setUTCDate(day.getUTCDate() - 1);
  const at = (h) => {
    const d = new Date(day);
    d.setUTCHours(h, 0, 0, 0);
    return d.toISOString();
  };

  const auth = { authorization: `Bearer ${token}` };
  const json = { 'content-type': 'application/json', ...auth };

  // --- Clean up anything this script left behind on a previous run.
  // Without this the fixture shift accumulates an extra hour per run and
  // a leftover pending request hides the "Request fix" button, so the
  // suite would drift from green to red for no product reason.
  const pending = await (
    await fetch(`${API}/api/v1/admin/corrections?status=pending`, { headers: auth })
  ).json();
  for (const req of pending.data ?? []) {
    if (req.user_id !== target.id) continue;
    await fetch(`${API}/api/v1/admin/corrections/${req.id}/decision`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ decision: 'rejected', note: 'E2E cleanup' }),
    });
  }

  const dayStr = at(9).slice(0, 10);
  const existing = await (
    await fetch(
      `${API}/api/v1/time-tracking/entries?userId=${target.id}&from=${dayStr}&to=${dayStr}T23:59:59Z&limit=100`,
      { headers: auth },
    )
  ).json();
  for (const e of existing.data ?? []) {
    if (e.status === 'deleted') continue;
    await fetch(
      `${API}/api/v1/admin/time-entries/${e.id}?reason=${encodeURIComponent('E2E cleanup')}`,
      { method: 'DELETE', headers: auth },
    );
  }

  const created = await fetch(`${API}/api/v1/admin/time-entries`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({
      userId: target.id,
      punchInAt: at(9),
      punchOutAt: at(17),
      reason: 'E2E fixture shift',
    }),
  });
  const createdBody = await created.json();
  if (!created.ok) {
    throw new Error(`fixture create failed: ${JSON.stringify(createdBody).slice(0, 300)}`);
  }
  return { token, userId: target.id, day: dayStr, entryId: createdBody.data?.id ?? null };
}

async function main() {
  const fixture = await seedShift(EMPLOYEE);
  record('seed a completed shift for the employee', true, fixture.day);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  try {
    // ---- Employee: see the punch and ask for a fix -----------------
    await login(page, EMPLOYEE);
    record('employee can log in', true);

    await page.goto(`${WEB}/dashboard/my-timesheet`, { waitUntil: 'networkidle' });
    // Next.js dev compiles a route on first hit, and React Query then has
    // to resolve — so wait for the content rather than sampling once.
    const punchesVisible = await page
      .getByText(/punches/i)
      .first()
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    record('My Timesheet lists individual punches', punchesVisible);
    await page.screenshot({ path: 'tools/e2e-01-my-timesheet.png', fullPage: true });

    const fixButton = page.getByRole('button', { name: /fix|request correction/i }).first();
    const hasFix = await fixButton
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    record('a punch row offers a "Request fix" action', hasFix);

    if (hasFix) {
      await fixButton.click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: 'tools/e2e-02-correction-modal.png', fullPage: true });

      const reason = page.locator('textarea').first();
      await reason.fill('Stayed an extra hour to finish the close-down checklist.');

      // Push the punch-out an hour later.
      const dtInputs = page.locator('input[type="datetime-local"]');
      const count = await dtInputs.count();
      if (count >= 2) {
        const current = await dtInputs.nth(1).inputValue();
        if (current) {
          const bumped = new Date(current);
          bumped.setHours(bumped.getHours() + 1);
          const pad = (n) => String(n).padStart(2, '0');
          const v = `${bumped.getFullYear()}-${pad(bumped.getMonth() + 1)}-${pad(bumped.getDate())}T${pad(bumped.getHours())}:${pad(bumped.getMinutes())}`;
          await dtInputs.nth(1).fill(v);
        }
      }
      record('correction modal exposes reason + editable times', count >= 1);

      const submit = page
        .getByRole('button', { name: /submit|send request|request correction/i })
        .last();
      await submit.click();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: 'tools/e2e-03-after-submit.png', fullPage: true });
    }

    // The API is the source of truth for whether it landed.
    const employeeToken = await page.evaluate(() =>
      window.localStorage.getItem('pc_token') ?? document.cookie,
    );
    record('employee session token present', !!employeeToken);

    await page.goto(`${WEB}/dashboard/corrections`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'tools/e2e-04-corrections-mine.png', fullPage: true });
    const mineVisible = await page
      .getByText(/my requests/i)
      .first()
      .isVisible()
      .catch(() => false);
    record('Corrections page shows "My requests"', mineVisible);

    // ---- Manager: review and approve -------------------------------
    const pending = await (
      await fetch(`${API}/api/v1/admin/corrections?status=pending`, {
        headers: { authorization: `Bearer ${fixture.token}` },
      })
    ).json();
    const queue = pending.data ?? [];
    record('request reached the approver queue', queue.length > 0, `${queue.length} pending`);

    const mgrPage = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
    await login(mgrPage, MANAGER);
    await mgrPage.goto(`${WEB}/dashboard/corrections`, { waitUntil: 'networkidle' });
    await mgrPage.screenshot({ path: 'tools/e2e-05-approval-queue.png', fullPage: true });

    const targetId = queue[0]?.id ?? null;

    const approveBtn = mgrPage.getByRole('button', { name: /^approve$/i }).first();
    const canApprove = await approveBtn
      .waitFor({ state: 'visible', timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    record('approver sees an Approve control', canApprove);

    if (canApprove) {
      await approveBtn.click();
      await mgrPage.waitForTimeout(2500);
      await mgrPage.screenshot({ path: 'tools/e2e-06-after-approve.png', fullPage: true });
    }

    // Assert on the specific request this run filed, so a leftover
    // approval from an earlier run cannot make this look green.
    const after = await (
      await fetch(`${API}/api/v1/admin/corrections?status=approved`, {
        headers: { authorization: `Bearer ${fixture.token}` },
      })
    ).json();
    const approved = (after.data ?? []).find((r) => r.id === targetId);
    record('the request filed in this run is now approved', !!approved, targetId ?? 'no target');

    // And the approval actually moved the worker's payable time.
    if (approved?.applied_entry_id) {
      const entries = await (
        await fetch(`${API}/api/v1/time-tracking/entries?userId=${fixture.userId}&limit=100`, {
          headers: { authorization: `Bearer ${fixture.token}` },
        })
      ).json();
      const entry = (entries.data ?? []).find((e) => e.id === approved.applied_entry_id);
      record(
        'the approved change is reflected in the time entry',
        !!entry && entry.durationMinutes === 540,
        entry ? `${entry.durationMinutes} payable minutes` : 'entry not found',
      );
    }

    record(
      'no uncaught console errors on the new screens',
      consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(' | '),
    );
  } finally {
    await browser.close();
  }

  const failed = steps.filter((s) => !s.ok);
  console.log(`\n${steps.length - failed.length}/${steps.length} checks passed`);
  if (failed.length > 0) {
    console.log('Failed:', failed.map((f) => f.name).join(', '));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('E2E run failed:', err);
  process.exit(1);
});
