/**
 * Browser check for onboarding a worker.
 *
 * The failure this guards against: an owner adds an employee, leaves the
 * password blank, and nothing usable ever reaches the worker because
 * email delivery isn't configured. The owner must be able to complete
 * onboarding entirely from the Team screen.
 *
 *   node tools/e2e-invite.mjs
 */
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL ?? 'http://localhost:3100';
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

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

try {
  const hireEmail = `browser-hire-${Date.now()}@quickstop.test`;

  await login(page, OWNER, PASSWORD);
  record('owner can log in', true);

  await page.goto(`${WEB}/dashboard/team`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /add user/i }).waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: /add user/i }).click();

  await page.locator('input[type="email"]').fill(hireEmail);
  // Deliberately leave the password blank — the path that used to fail.
  await page.getByRole('button', { name: /add to team/i }).click();

  const panel = page.getByText(/sign-in link for/i).first();
  const shown = await panel
    .waitFor({ state: 'visible', timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  record('a sign-in link is shown after adding without a password', shown);
  await page.screenshot({ path: 'tools/e2e-invite-01-link.png', fullPage: true });

  const link = await page.locator('#setup-link').inputValue();
  record('the link points at the password setup page', link.includes('/reset-password?token='));

  const honest = await page.getByText(/not set up, so this was not sent/i).isVisible().catch(() => false);
  record('it says plainly that no email was sent', honest);

  const flagged = await page.getByText(/no password set/i).first().isVisible().catch(() => false);
  record('the team list flags who still has no password', flagged);

  // The worker's side: open the link in a clean context and set a password.
  const workerCtx = await browser.newContext();
  const worker = await workerCtx.newPage();
  await worker.goto(link, { waitUntil: 'networkidle' });
  const pwInputs = worker.locator('input[type="password"]');
  await pwInputs.first().waitFor({ timeout: 30_000 });
  const n = await pwInputs.count();
  for (let i = 0; i < n; i++) await pwInputs.nth(i).fill('WorkerChosen-2026');
  await worker.getByRole('button', { name: /reset|set|save|continue/i }).first().click();
  await worker.waitForTimeout(2500);
  await worker.screenshot({ path: 'tools/e2e-invite-02-set-password.png', fullPage: true });

  await login(worker, hireEmail, 'WorkerChosen-2026');
  record('the worker can set a password and sign in', worker.url().includes('/dashboard'));

  // Back on the owner's side, the flag should be gone after a refresh.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const rowGone = !(await page
    .getByRole('row', { name: new RegExp(hireEmail, 'i') })
    .getByText(/no password set/i)
    .isVisible()
    .catch(() => false));
  record('the team list stops flagging them once they have a password', rowGone);

  record('no uncaught console errors', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

const failed = steps.filter((s) => !s.ok);
console.log(`\n${steps.length - failed.length}/${steps.length} checks passed`);
if (failed.length > 0) {
  console.log('Failed:', failed.map((f) => f.name).join(', '));
  process.exit(1);
}
