/**
 * Browser check for pay-period locking.
 *
 * Proves the screens are wired to the API and, most importantly, that a
 * lock actually stops a retroactive edit — the whole point of the
 * feature. The API integration suite covers the enforcement matrix; this
 * covers "can an owner actually do it from the product".
 *
 *   node tools/e2e-pay-periods.mjs
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
const API = process.env.API_URL ?? 'http://localhost:4000';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Demo12345';
const OWNER = process.env.OWNER_EMAIL ?? 'owner@quickstop.test';

const steps = [];
function record(name, ok, detail = '') {
  steps.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function login(page, email, password) {
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function apiToken() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: OWNER, password: PASSWORD }),
  });
  const body = await res.json();
  if (!body?.data?.token) throw new Error('owner login failed');
  return body.data.token;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

try {
  const token = await apiToken();
  const auth = { authorization: `Bearer ${token}` };

  // Start from a known state: nothing locked.
  const periods = await (
    await fetch(`${API}/api/v1/admin/pay-periods?count=8`, { headers: auth })
  ).json();
  for (const p of periods.data ?? []) {
    if (p.status === 'locked') {
      await fetch(`${API}/api/v1/admin/pay-periods/unlock`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ startDate: p.startDate, reason: 'E2E reset' }),
      });
    }
  }

  await login(page, OWNER, PASSWORD);
  record('owner can log in', true);

  await page.goto(`${WEB}/dashboard/pay-periods`, { waitUntil: 'networkidle' });
  const heading = await page
    .getByRole('heading', { name: /pay period/i })
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  record('pay periods page renders', heading);
  await page.screenshot({ path: 'tools/e2e-pay-01-list.png', fullPage: true });

  const currentChip = await page
    .getByText(/current/i)
    .first()
    .isVisible()
    .catch(() => false);
  record('the current period is marked', currentChip);

  // Lock the second-most-recent period (not the current one, so the
  // punch clock stays usable for other checks).
  const target = (periods.data ?? [])[1];
  if (!target) throw new Error('no period to lock');

  const lockButtons = page.getByRole('button', { name: /^lock$/i });
  const lockCount = await lockButtons.count();
  record('owner sees Lock actions', lockCount > 0, `${lockCount} rows lockable`);

  if (lockCount > 1) {
    await lockButtons.nth(1).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'tools/e2e-pay-02-confirm.png', fullPage: true });
    // Exact name: a loose regex with .last() matches the bottom ROW's
    // "Lock" button instead of the panel's confirm.
    await page.getByRole('button', { name: /^lock period$/i }).click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: 'tools/e2e-pay-03-locked.png', fullPage: true });
  }

  const after = await (
    await fetch(`${API}/api/v1/admin/pay-periods?count=8`, { headers: auth })
  ).json();
  const lockedNow = (after.data ?? []).filter((p) => p.status === 'locked');
  record('a period is locked after using the UI', lockedNow.length > 0, `${lockedNow.length} locked`);

  // The point of the whole feature: the lock must actually refuse a change.
  if (lockedNow.length > 0) {
    const locked = lockedNow[0];
    const midday = `${locked.startDate}T12:00:00.000Z`;
    const created = await fetch(`${API}/api/v1/admin/time-entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        userId: (await (await fetch(`${API}/api/v1/admin/users`, { headers: auth })).json()).data[0]
          .id,
        punchInAt: midday,
        punchOutAt: `${locked.startDate}T16:00:00.000Z`,
        reason: 'should be refused',
      }),
    });
    const body = await created.json();
    record(
      'a locked period refuses a retroactive entry',
      created.status === 409,
      `HTTP ${created.status}: ${body?.error?.message?.slice(0, 70) ?? ''}`,
    );
  }

  // Unlock from the UI and confirm it reopens.
  await page.reload({ waitUntil: 'networkidle' });
  const unlockBtn = page.getByRole('button', { name: /^unlock$/i }).first();
  const canUnlock = await unlockBtn
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  record('owner sees an Unlock action on a locked row', canUnlock);

  if (canUnlock) {
    await unlockBtn.click();
    await page.waitForTimeout(600);
    const reason = page.locator('textarea').first();
    await reason.fill('Reopening for an E2E check');
    await page.screenshot({ path: 'tools/e2e-pay-04-unlock.png', fullPage: true });
    await page.getByRole('button', { name: /^unlock period$/i }).click();
    await page.waitForTimeout(2500);
  }

  const final = await (
    await fetch(`${API}/api/v1/admin/pay-periods?count=8`, { headers: auth })
  ).json();
  record(
    'the period reopens after unlocking',
    (final.data ?? []).every((p) => p.status === 'open'),
  );

  // Settings round-trip for auto clock-out.
  await page.goto(`${WEB}/dashboard/settings`, { waitUntil: 'networkidle' });
  const payrollSection = await page
    .getByText(/payroll/i)
    .first()
    .waitFor({ state: 'visible', timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  record('settings exposes the payroll section', payrollSection);
  await page.screenshot({ path: 'tools/e2e-pay-05-settings.png', fullPage: true });

  // Pre-existing and unrelated: React logs a dev-only hydration mismatch
  // for the geofence "Radius (m)" input on Settings (a caret-color style
  // applied client-side). It predates this branch — the Settings diff here
  // is purely additive and does not touch that field — so it is excluded
  // rather than allowed to mask real regressions in everything else.
  const KNOWN_PRE_EXISTING = /hydrated but some attributes|caret-color/i;
  const unexpected = errors.filter((e) => !KNOWN_PRE_EXISTING.test(e));
  record('no unexpected console errors', unexpected.length === 0, unexpected.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

const failed = steps.filter((s) => !s.ok);
console.log(`\n${steps.length - failed.length}/${steps.length} checks passed`);
if (failed.length > 0) {
  console.log('Failed:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
