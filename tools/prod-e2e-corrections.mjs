// Why did the correction request not get created? Watch the network.
//   node tools/prod-e2e-corrections.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const WEB = 'https://punchclock-web-lake.vercel.app';
const OWNER = { email: 'qa.owner@punchclock.test', password: 'QaTest!2026#PunchClock' };
mkdirSync('tools/e2e-corr', { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 950 } });
const page = await ctx.newPage();
const net = [];
page.on('request', (r) => {
  if (r.url().includes('punchclock-api.fly.dev') && r.method() !== 'GET') {
    net.push(`→ ${r.method()} ${new URL(r.url()).pathname}  body=${(r.postData() || '').slice(0, 200)}`);
  }
});
page.on('response', async (r) => {
  if (r.url().includes('punchclock-api.fly.dev') && r.request().method() !== 'GET') {
    net.push(`← ${r.status()} ${new URL(r.url()).pathname}  ${(await r.text().catch(() => '')).slice(0, 240)}`);
  }
});

await page.goto(WEB + '/login', { waitUntil: 'domcontentloaded' });
await page.locator('input[type="email"]').first().fill(OWNER.email);
await page.locator('input[type="password"]').first().fill(OWNER.password);
await page.locator('button[type="submit"]').first().click();
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 40000 }).catch(() => {});
await page.waitForTimeout(1500);
console.log('logged in:', page.url());

await page.goto(WEB + '/dashboard/my-timesheet', { waitUntil: 'domcontentloaded' });
await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);

const entry = page.locator('button:has-text("Missing a shift?")').first();
console.log('\n"Missing a shift?" button present:', await entry.count());
await entry.click();
await page.waitForTimeout(2000);
await page.screenshot({ path: 'tools/e2e-corr/01-modal.png', fullPage: true });

// what is actually in the dialog?
const fields = await page.locator('input:visible, textarea:visible, select:visible').evaluateAll((els) =>
  els.map((e) => ({
    tag: e.tagName.toLowerCase(),
    type: e.getAttribute('type'),
    name: e.getAttribute('name'),
    placeholder: e.getAttribute('placeholder'),
    required: e.required,
    value: e.value,
  }))
);
console.log('\nFIELDS IN THE CORRECTION FORM:');
console.log(JSON.stringify(fields, null, 1));

const dialogButtons = await page.locator('button:visible').evaluateAll((els) =>
  els.map((e) => `${e.textContent.trim()}${e.disabled ? ' [DISABLED]' : ''}`)
);
console.log('\nBUTTONS:', JSON.stringify(dialogButtons));

// fill everything sensibly
for (const f of fields) {
  const sel = f.name ? `[name="${f.name}"]` : null;
  if (!sel) continue;
  const loc = page.locator(sel).first();
  if (!(await loc.count())) continue;
  if (f.tag === 'textarea') await loc.fill('QA automated test - please ignore').catch(() => {});
  else if (f.type === 'datetime-local') await loc.fill('2026-09-12T09:00').catch(() => {});
  else if (f.type === 'date') await loc.fill('2026-09-12').catch(() => {});
  else if (f.type === 'time') await loc.fill('09:00').catch(() => {});
}
// generic fallbacks for unnamed fields (the real form uses date + time + time)
const dtl = page.locator('input[type="datetime-local"]:visible');
for (let i = 0; i < await dtl.count(); i++) {
  await dtl.nth(i).fill(i === 0 ? '2026-09-12T09:00' : '2026-09-12T17:00').catch(() => {});
}
const dOnly = page.locator('input[type="date"]:visible');
for (let i = 0; i < await dOnly.count(); i++) await dOnly.nth(i).fill('2026-09-12').catch(() => {});
const tOnly = page.locator('input[type="time"]:visible');
for (let i = 0; i < await tOnly.count(); i++) {
  await tOnly.nth(i).fill(i === 0 ? '09:00' : '17:00').catch(() => {});
}
const ta = page.locator('textarea:visible').first();
if (await ta.count()) await ta.fill('QA automated test - please ignore').catch(() => {});

await page.screenshot({ path: 'tools/e2e-corr/02-filled.png', fullPage: true });
net.length = 0;

const submit = page.locator('button:has-text("Submit"), button:has-text("Request"), button:has-text("Send")').last();
console.log('\nsubmit button text:', await submit.innerText().catch(() => 'n/a'),
            '| disabled:', await submit.isDisabled().catch(() => 'n/a'));
await submit.click().catch((e) => console.log('click failed:', e.message.split('\n')[0]));
await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(3000);
await page.screenshot({ path: 'tools/e2e-corr/03-after-submit.png', fullPage: true });

console.log('\nNETWORK (non-GET) AFTER SUBMIT:');
net.length ? net.forEach((n) => console.log('  ' + n)) : console.log('  *** NOTHING SENT — the form never called the API ***');

const txt = await page.locator('body').innerText();
const errs = txt.split('\n').filter((l) => /required|invalid|error|must|cannot|please/i.test(l)).slice(0, 12);
console.log('\nVALIDATION / ERROR TEXT ON SCREEN:');
errs.length ? errs.forEach((e) => console.log('  ' + e.trim())) : console.log('  none');

await browser.close();
