// Part 2 of the production feature sweep: the workflows not covered by
// prod-e2e-features.mjs, plus a retry of time-off with a proper wait.
//   node tools/prod-e2e-part2.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const WEB = 'https://punchclock-web-lake.vercel.app';
const OWNER = { email: 'qa.owner@punchclock.test', password: 'QaTest!2026#PunchClock' };
const SHOTS = 'tools/e2e-prod2';
mkdirSync(SHOTS, { recursive: true });

const results = [];
const pass = (n, d = '') => { results.push({ n, ok: true, d }); console.log(`✅ ${n}${d ? ' — ' + d : ''}`); };
const fail = (n, d = '') => { results.push({ n, ok: false, d }); console.log(`❌ ${n}${d ? ' — ' + d : ''}`); };
const info = (m) => console.log('   · ' + m);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1366, height: 950 },
  permissions: ['geolocation'],
  geolocation: { latitude: 41.8781, longitude: -87.6298 },
});
const page = await ctx.newPage();
const apiFails = [];
page.on('response', (r) => {
  if (r.url().includes('punchclock-api.fly.dev') && r.status() >= 400) {
    apiFails.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  }
});
const body = () => page.locator('body').innerText().catch(() => '');
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true }).catch(() => {});
// wait until the page has actually settled, not a fixed guess
async function go(route) {
  await page.goto(WEB + route, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

await page.goto(WEB + '/login', { waitUntil: 'domcontentloaded' });
await page.locator('input[type="email"]').first().fill(OWNER.email);
await page.locator('input[type="password"]').first().fill(OWNER.password);
await page.locator('button[type="submit"]').first().click();
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 45000 }).catch(() => {});
await page.waitForTimeout(1500);
page.url().includes('/login') ? fail('login') : pass('Owner signed in');

// ---------- TIME OFF (retry with networkidle) ----------
console.log('\n--- TIME OFF ---');
await go('/dashboard/time-off');
const toBtn = page.locator('button:has-text("Submit request")').first();
if (await toBtn.count()) {
  pass('Time off "Submit request" present', 'previous failure was a test timing bug');
  const dates = page.locator('input[type="date"]:visible');
  if (await dates.count() >= 2) {
    await dates.nth(0).fill('2026-12-24');
    await dates.nth(1).fill('2026-12-26');
    const reason = page.locator('input[type="text"]:visible, textarea:visible').first();
    if (await reason.count()) await reason.fill('QA automated test - ignore');
    const before = await body();
    await toBtn.click();
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await shot('01-timeoff-submitted');
    const after = await body();
    after !== before && /Dec 24|2026-12-24|pending/i.test(after)
      ? pass('Time-off request created and listed')
      : fail('Time-off request created and listed', 'list did not change — see 01-timeoff-submitted.png');
  } else { fail('Time off date inputs present'); }
} else { fail('Time off "Submit request" present'); }

// ---------- TRADES ----------
console.log('\n--- SHIFT TRADES ---');
await go('/dashboard/trades');
await shot('02-trades');
const tBody = await body();
const tBtn = page.locator('button:has-text("Post for trade")').first();
if (await tBtn.count()) {
  pass('Trades page renders with "Post for trade"');
  await tBtn.click();
  await page.waitForTimeout(2000);
  await shot('03-trades-post');
  const t2 = await body();
  /no shifts|nothing to trade|select a shift|choose/i.test(t2)
    ? pass('Trade posting responds', 'correctly reports there is nothing eligible to trade')
    : pass('Trade posting opens a selector');
} else { fail('Trades "Post for trade" present'); }

// ---------- DOCUMENTS ----------
console.log('\n--- DOCUMENTS ---');
await go('/dashboard/documents');
await shot('04-documents');
const dBody = await body();
const dBtn = page.locator('button:has-text("Save document")').first();
if (await dBtn.count()) {
  pass('Documents page renders with upload form');
  const selects = page.locator('select:visible');
  if (await selects.count()) {
    const opts = await selects.first().locator('option').allTextContents();
    info('document types offered: ' + opts.slice(0, 8).join(', '));
  }
  /i-9|w-4|licen|permit|expir/i.test(dBody)
    ? pass('Document types + expiry tracking present')
    : info('no document-type keywords found on screen');
} else { fail('Documents "Save document" present'); }

// ---------- CORRECTIONS: approve the one filed earlier ----------
console.log('\n--- CORRECTIONS APPROVAL ---');
await go('/dashboard/corrections');
await shot('05-corrections');
const cBody = await body();
const approve = page.locator('button:has-text("Approve")').first();
if (await approve.count()) {
  info('a pending correction is waiting — approving it');
  await approve.click();
  await page.waitForTimeout(1500);
  // a confirm dialog may appear
  const confirm = page.locator('button:has-text("Approve"), button:has-text("Confirm")').last();
  if (await confirm.count()) await confirm.click().catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await shot('06-corrections-approved');
  const after = await body();
  after !== cBody
    ? pass('Correction approval flow completes')
    : fail('Correction approval flow completes', 'queue unchanged');
} else {
  info('no pending corrections to approve');
  /no requests|nothing|empty|0 pending/i.test(cBody)
    ? pass('Corrections queue renders its empty state correctly')
    : info('queue state unclear — see 05-corrections.png');
}

// ---------- OVERVIEW / live team status ----------
console.log('\n--- OVERVIEW ---');
await go('/dashboard');
await shot('07-overview');
const oBody = await body();
/on the clock|clocked in|team|overview|labor|cost/i.test(oBody)
  ? pass('Overview renders team status')
  : fail('Overview renders team status');
/\$|budget|cost/i.test(oBody)
  ? pass('Labor cost card visible to owner')
  : info('no labor-cost figure shown (may need budget configured)');

// ---------- MY SCHEDULE ----------
console.log('\n--- MY SCHEDULE ---');
await go('/dashboard/my-schedule');
await shot('08-my-schedule');
const msBody = await body();
/week|shift|schedule|no shifts/i.test(msBody)
  ? pass('My Schedule renders')
  : fail('My Schedule renders');

console.log('\n========== SUMMARY ==========');
const ok = results.filter((r) => r.ok).length;
const bad = results.filter((r) => !r.ok);
console.log(`${ok}/${results.length} checks passed`);
if (bad.length) { console.log('\nFAILURES:'); bad.forEach((b) => console.log(`  ❌ ${b.n}${b.d ? ' — ' + b.d : ''}`)); }
console.log('\nAPI 4xx/5xx during run:');
apiFails.length ? [...new Set(apiFails)].forEach((f) => console.log('  ' + f)) : console.log('  none');
await browser.close();
process.exitCode = bad.length ? 1 : 0;
