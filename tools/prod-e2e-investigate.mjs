// Focused investigation of the three failures from prod-e2e-features.mjs.
//   node tools/prod-e2e-investigate.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const WEB = 'https://punchclock-web-lake.vercel.app';
const OWNER = { email: 'qa.owner@punchclock.test', password: 'QaTest!2026#PunchClock' };
const WORKER = { email: 'qa.worker@punchclock.test', password: 'QaTest!2026#PunchClock' };
mkdirSync('tools/e2e-investigate', { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 950 } });
const page = await ctx.newPage();
const calls = [];
page.on('response', (r) => {
  if (r.url().includes('punchclock-api.fly.dev')) calls.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
});
const login = async (w) => {
  await page.goto(WEB + '/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(w.email);
  await page.locator('input[type="password"]').first().fill(w.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(2000);
};
const logout = async () => {
  const b = page.locator('button:has-text("Sign out")').first();
  if (await b.count()) { await b.click(); await page.waitForTimeout(2500); }
};

// ============ 1. TIME OFF as owner ============
console.log('\n===== 1. TIME OFF PAGE (owner) =====');
await login(OWNER);
await page.goto(WEB + '/dashboard/time-off', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.screenshot({ path: 'tools/e2e-investigate/timeoff.png', fullPage: true });
const btns = await page.locator('button:visible').evaluateAll((e) => e.map((x) => x.textContent.trim()).filter(Boolean));
console.log('visible buttons:', JSON.stringify(btns));
const inputs = await page.locator('input:visible, textarea:visible, select:visible').evaluateAll((e) =>
  e.map((x) => `${x.tagName.toLowerCase()}[type=${x.getAttribute('type') || 'n/a'}][name=${x.getAttribute('name') || '?'}]`)
);
console.log('visible fields:', JSON.stringify(inputs));
const disabled = await page.locator('button:visible').evaluateAll((e) =>
  e.filter((x) => x.disabled).map((x) => x.textContent.trim())
);
console.log('DISABLED buttons:', JSON.stringify(disabled));
console.log('page text (first 500):\n', (await page.locator('body').innerText()).slice(0, 500));

// ============ 2/3. WORKER hitting privileged pages ============
await logout();
console.log('\n===== 2. WORKER -> /dashboard/settings =====');
await login(WORKER);
calls.length = 0;
await page.goto(WEB + '/dashboard/settings', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.screenshot({ path: 'tools/e2e-investigate/worker-settings.png', fullPage: true });
console.log('landed:', page.url());
console.log('API calls made:', JSON.stringify([...new Set(calls)], null, 1));
const sTxt = await page.locator('body').innerText();
console.log('--- WHAT THE WORKER ACTUALLY SEES (first 900 chars) ---');
console.log(sTxt.slice(0, 900));
const sInputs = await page.locator('input:visible').evaluateAll((e) =>
  e.map((x) => `${x.getAttribute('name') || x.getAttribute('placeholder') || '?'}="${(x.value || '').slice(0, 40)}"`)
);
console.log('--- form values visible to worker ---');
console.log(JSON.stringify(sInputs, null, 1));

console.log('\n===== 3. WORKER -> /dashboard/audit-log =====');
calls.length = 0;
await page.goto(WEB + '/dashboard/audit-log', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.screenshot({ path: 'tools/e2e-investigate/worker-audit.png', fullPage: true });
console.log('API calls made:', JSON.stringify([...new Set(calls)], null, 1));
const aTxt = await page.locator('body').innerText();
console.log('--- WHAT THE WORKER ACTUALLY SEES (first 900 chars) ---');
console.log(aTxt.slice(0, 900));
const rows = await page.locator('table tr, [role="row"]').count();
console.log('table rows rendered:', rows);

console.log('\n===== 4. WORKER hitting the API directly (the real test) =====');
const token = await page.evaluate(() => {
  const m = document.cookie.match(/pc_token=([^;]+)/);
  return m ? m[1] : null;
});
console.log('token from cookie:', token ? 'present' : 'NOT READABLE FROM JS (httpOnly)');
if (token) {
  for (const p of ['/api/v1/admin/audit-logs', '/api/v1/admin/users', '/api/v1/admin/exports/payroll.iif?from=2026-09-01&to=2026-09-13']) {
    const r = await page.evaluate(async ([path, tok]) => {
      const res = await fetch('https://punchclock-api.fly.dev' + path, { headers: { Authorization: 'Bearer ' + tok } });
      return { status: res.status, body: (await res.text()).slice(0, 160) };
    }, [p, token]);
    console.log(`  ${r.status}  ${p}\n      ${r.body}`);
  }
}
await browser.close();
