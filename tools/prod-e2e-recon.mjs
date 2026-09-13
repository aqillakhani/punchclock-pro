// Production reconnaissance sweep for PunchClock Pro.
//   node tools/prod-e2e-recon.mjs
// Logs in through the real UI, visits every dashboard route, and reports
// what rendered, what errored, and what interactive controls exist.
// Read-only: it never submits a form.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const WEB = process.env.WEB_URL || 'https://punchclock-web-lake.vercel.app';
const EMAIL = process.env.QA_EMAIL || 'qa.owner@punchclock.test';
const PASSWORD = process.env.QA_PASSWORD || 'QaTest!2026#PunchClock';
const SHOTS = 'tools/recon';
mkdirSync(SHOTS, { recursive: true });

const ROUTES = [
  '/dashboard',
  '/dashboard/clock',
  '/dashboard/my-timesheet',
  '/dashboard/my-schedule',
  '/dashboard/time-off',
  '/dashboard/trades',
  '/dashboard/corrections',
  '/dashboard/documents',
  '/dashboard/team',
  '/dashboard/schedule',
  '/dashboard/timesheets',
  '/dashboard/pay-periods',
  '/dashboard/reports',
  '/dashboard/audit-log',
  '/dashboard/preview-as',
  '/dashboard/settings',
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  permissions: ['geolocation'],
  geolocation: { latitude: 41.8781, longitude: -87.6298 }, // Chicago, matches org tz
  locale: 'en-US',
});
const page = await ctx.newPage();

const consoleErrors = [];
const failedReqs = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${page.url()}] ${m.text()}`); });
page.on('pageerror', (e) => consoleErrors.push(`[${page.url()}] PAGEERROR: ${e.message}`));
page.on('response', (r) => {
  if (r.url().includes('punchclock-api.fly.dev') && r.status() >= 400) {
    failedReqs.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  }
});

// ---------- login ----------
console.log('### LOGIN');
await page.goto(WEB + '/login', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.locator('input[type="email"], input[name="email"]').first().fill(EMAIL);
await page.locator('input[type="password"], input[name="password"]').first().fill(PASSWORD);
await Promise.all([
  page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 45000 }).catch(() => {}),
  page.locator('button[type="submit"]').first().click(),
]);
await page.waitForTimeout(2500);
console.log('after login ->', page.url());
if (page.url().includes('/login')) {
  const err = await page.locator('body').innerText();
  console.log('LOGIN FAILED. Page text:\n', err.slice(0, 600));
  await page.screenshot({ path: `${SHOTS}/login-failed.png` });
  await browser.close();
  process.exit(1);
}
console.log('✅ logged in\n');

// ---------- sidebar ----------
const navLinks = await page.locator('a[href^="/dashboard"]').evaluateAll((els) =>
  [...new Set(els.map((e) => e.getAttribute('href') + ' :: ' + e.textContent.trim().replace(/\s+/g, ' ')))]
);
console.log('### SIDEBAR VISIBLE TO OWNER');
navLinks.forEach((l) => console.log('  ' + l));
console.log('');

// ---------- sweep ----------
const results = [];
for (const route of ROUTES) {
  const before = consoleErrors.length;
  const beforeReq = failedReqs.length;
  let status = 'ok';
  try {
    const resp = await page.goto(WEB + route, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2200);
    if (resp && resp.status() >= 400) status = 'HTTP ' + resp.status();
  } catch (e) {
    status = 'NAV ERROR: ' + e.message.split('\n')[0];
  }
  const landed = new URL(page.url()).pathname;
  const redirected = landed !== route;
  const h1 = await page.locator('h1').first().innerText().catch(() => '(no h1)');
  const bodyText = await page.locator('body').innerText().catch(() => '');
  const looksBroken = /something went wrong|unexpected error|application error|failed to fetch|500|not found/i.test(bodyText);
  const buttons = await page.locator('button:visible').evaluateAll((els) =>
    [...new Set(els.map((e) => e.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean))].slice(0, 14)
  );
  const newErrs = consoleErrors.length - before;
  const newFails = failedReqs.length - beforeReq;

  results.push({ route, landed, redirected, status, h1: h1.replace(/\s+/g, ' ').slice(0, 60), looksBroken, newErrs, newFails, buttons });
  await page.screenshot({ path: `${SHOTS}/${route.replace(/\//g, '_')}.png`, fullPage: false });
}

console.log('### ROUTE SWEEP');
for (const r of results) {
  const flags = [
    r.status !== 'ok' ? `STATUS=${r.status}` : '',
    r.redirected ? `REDIRECTED->${r.landed}` : '',
    r.looksBroken ? 'ERROR-TEXT-ON-PAGE' : '',
    r.newErrs ? `console:${r.newErrs}` : '',
    r.newFails ? `apiFail:${r.newFails}` : '',
  ].filter(Boolean).join(' ');
  console.log(`${r.looksBroken || r.status !== 'ok' ? '❌' : '✅'} ${r.route.padEnd(28)} h1="${r.h1}" ${flags}`);
  if (r.buttons.length) console.log(`     buttons: ${r.buttons.join(' | ')}`);
}

console.log('\n### FAILED API CALLS');
failedReqs.length ? [...new Set(failedReqs)].forEach((f) => console.log('  ' + f)) : console.log('  none');

console.log('\n### CONSOLE ERRORS');
consoleErrors.length ? [...new Set(consoleErrors)].slice(0, 25).forEach((e) => console.log('  ' + e.slice(0, 220))) : console.log('  none');

await browser.close();
