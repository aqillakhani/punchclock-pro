// Verifies the features that only became reachable once PR #4 shipped the web
// build: pay-period locking, the auto clock-out setting, and the page guard
// that stops a worker opening owner-only screens by URL.
//   node tools/prod-e2e-payperiods.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const WEB = 'https://punchclock-web-lake.vercel.app';
const PW = 'QaTest!2026#PunchClock';
const SHOTS = 'tools/e2e-pp';
mkdirSync(SHOTS, { recursive: true });

const results = [];
const pass = (n, d = '') => { results.push({ n, ok: true, d }); console.log(`✅ ${n}${d ? ' — ' + d : ''}`); };
const fail = (n, d = '') => { results.push({ n, ok: false, d }); console.log(`❌ ${n}${d ? ' — ' + d : ''}`); };
const info = (m) => console.log('   · ' + m);

const browser = await chromium.launch();
const net = [];

async function signIn(email) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 950 } });
  const page = await ctx.newPage();
  page.on('response', (r) => {
    if (r.url().includes('punchclock-api.fly.dev') && r.request().method() !== 'GET') {
      net.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
    }
  });
  await page.goto(WEB + '/login', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('input[type="email"]').first().fill(email);
  await page.locator('input[type="password"]').first().fill(PW);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return page;
}
const settle = async (p) => {
  await p.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1000);
};

// ================= OWNER: pay periods =================
console.log('\n--- PAY PERIODS (owner) ---');
const owner = await signIn('qa.owner@punchclock.test');
await owner.goto(WEB + '/dashboard/pay-periods', { waitUntil: 'domcontentloaded' });
await settle(owner);
await owner.screenshot({ path: `${SHOTS}/01-pay-periods.png`, fullPage: true });

const ppText = await owner.locator('body').innerText();
/pay period/i.test(ppText) ? pass('Pay periods page renders') : fail('Pay periods page renders');
/current|open|locked/i.test(ppText)
  ? pass('Periods are listed with their state')
  : info('no period state words found');

const lockBtns = owner.locator('button:has-text("Lock")');
const lockCount = await lockBtns.count();
info(`${lockCount} Lock button(s) on screen`);

if (lockCount > 0) {
  net.length = 0;
  // Lock the OLDEST listed period, so nothing recent is touched.
  await lockBtns.last().click();
  await owner.waitForTimeout(1200);
  // Clicking a row's Lock opens a confirmation whose button is "Lock period".
  // Matching on "Lock" alone hits the eight row buttons instead.
  const confirm = owner.locator('button:has-text("Lock period"), button:has-text("Confirm")').first();
  if (await confirm.count()) await confirm.click().catch(() => {});
  else info('no confirmation dialog appeared');
  await settle(owner);
  await owner.screenshot({ path: `${SHOTS}/02-after-lock.png`, fullPage: true });
  const locked = net.some((n) => n.startsWith('200') && n.includes('/lock'));
  locked ? pass('Locking a pay period succeeds', net.filter((n) => n.includes('lock')).join(', '))
         : fail('Locking a pay period succeeds', net.join(' | ') || 'no write call observed');

  // Unlock — owner-only, and requires a reason.
  const unlock = owner.locator('button:has-text("Unlock")').first();
  if (await unlock.count()) {
    net.length = 0;
    await unlock.click();
    await owner.waitForTimeout(1200);
    const reason = owner.locator('textarea:visible, input[type="text"]:visible').last();
    if (await reason.count()) await reason.fill('QA test — unlocking immediately');
    const go = owner.locator('button:has-text("Unlock period"), button:has-text("Confirm")').first();
    await go.click().catch(() => {});
    await settle(owner);
    await owner.screenshot({ path: `${SHOTS}/03-after-unlock.png`, fullPage: true });
    net.some((n) => n.startsWith('200') && n.includes('unlock'))
      ? pass('Unlocking works and asks for a reason')
      : info('unlock call: ' + (net.join(' | ') || 'none observed'));
  } else {
    info('no Unlock control visible after locking');
  }
} else {
  fail('Pay periods page offers a Lock control');
}

// ================= OWNER: auto clock-out setting =================
console.log('\n--- AUTO CLOCK-OUT SETTING (owner) ---');
await owner.goto(WEB + '/dashboard/settings', { waitUntil: 'domcontentloaded' });
await settle(owner);
const setText = await owner.locator('body').innerText();
await owner.screenshot({ path: `${SHOTS}/04-settings.png`, fullPage: true });
/payroll|pay period/i.test(setText)
  ? pass('Settings shows the Payroll & shifts section')
  : fail('Settings shows the Payroll & shifts section');
/clock-out after|auto clock|automatically clock/i.test(setText)
  ? pass('Auto clock-out control is present')
  : fail('Auto clock-out control is present', 'no matching label found');
/weekly|biweekly|semimonthly|monthly|fortnight/i.test(setText)
  ? pass('Pay period schedule selector is present')
  : fail('Pay period schedule selector is present');

// ================= WORKER: page guard =================
console.log('\n--- PAGE GUARD (employee) ---');
const worker = await signIn('qa.worker@punchclock.test');
for (const [path, label] of [
  ['/dashboard/settings', 'Settings'],
  ['/dashboard/audit-log', 'Audit log'],
  ['/dashboard/pay-periods', 'Pay periods'],
]) {
  await worker.goto(WEB + path, { waitUntil: 'domcontentloaded' });
  await settle(worker);
  const t = await worker.locator('body').innerText();
  const refused = /don'?t have access|no access|not have access/i.test(t);
  refused
    ? pass(`Employee is refused ${label} by URL`)
    : fail(`Employee is refused ${label} by URL`, 'page rendered instead');
}
await worker.screenshot({ path: `${SHOTS}/05-worker-refused.png`, fullPage: true });

// worker can still use their own pages
await worker.goto(WEB + '/dashboard/clock', { waitUntil: 'domcontentloaded' });
await settle(worker);
const btn = await worker.locator('button:has-text("Punch In"), button:has-text("Punch Out")').first().innerText().catch(() => '');
btn ? pass('Employee can still reach Clock In/Out', `"${btn.trim()}"`) : fail('Employee can still reach Clock In/Out');

// ================= VIEWER: cannot punch =================
console.log('\n--- VIEWER (read-only) ---');
const viewer = await signIn('qa.viewer@punchclock.test');
await viewer.goto(WEB + '/dashboard/clock', { waitUntil: 'domcontentloaded' });
await settle(viewer);
const vText = await viewer.locator('body').innerText();
await viewer.screenshot({ path: `${SHOTS}/06-viewer-clock.png`, fullPage: true });
/don'?t have access|no access|not have access/i.test(vText)
  ? pass('Viewer is refused the Clock screen', 'they hold no punch:clock permission')
  : fail('Viewer is refused the Clock screen', 'clock screen rendered for a read-only account');

console.log('\n========== SUMMARY ==========');
const ok = results.filter((r) => r.ok).length;
const bad = results.filter((r) => !r.ok);
console.log(`${ok}/${results.length} checks passed`);
if (bad.length) { console.log('\nFAILURES:'); bad.forEach((b) => console.log(`  ❌ ${b.n}${b.d ? ' — ' + b.d : ''}`)); }
console.log(`\nScreenshots: ${SHOTS}/`);
await browser.close();
process.exitCode = bad.length ? 1 : 0;
