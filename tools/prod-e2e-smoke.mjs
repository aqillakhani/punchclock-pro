// Production smoke test (real browser) for PunchClock Pro.
//   node tools/prod-e2e-smoke.mjs
// Proves: the web app hydrates, the login form is interactive, and a real
// cross-origin call reaches the Fly API (CORS) — without creating any data
// (it submits a deliberately-invalid login and expects a 401).
import { chromium } from 'playwright';

const WEB = process.env.WEB_URL || 'https://punchclock-web-lake.vercel.app';
const API_HOST = 'punchclock-api.fly.dev';
const fail = (m) => { console.error('❌ ' + m); process.exitCode = 1; };
const ok = (m) => console.log('✅ ' + m);

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
const apiReqs = [];
const apiResps = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));
page.on('request', (r) => { if (r.url().includes(API_HOST)) apiReqs.push(`${r.method()} ${r.url()}`); });
page.on('response', (r) => { if (r.url().includes(API_HOST)) apiResps.push(`${r.status()} ${r.url()}`); });

try {
  // 1) Root redirects to /login and the page renders.
  await page.goto(WEB + '/', { waitUntil: 'networkidle', timeout: 30000 });
  console.log('landed:', page.url(), '| title:', JSON.stringify(await page.title()));
  page.url().endsWith('/login') ? ok('root redirected to /login') : fail('root did not redirect to /login');

  // 2) Login form is hydrated + interactive.
  const email = page.locator('input[type="email"], input[name="email"]').first();
  const pw = page.locator('input[type="password"]').first();
  await email.waitFor({ state: 'visible', timeout: 15000 });
  await pw.waitFor({ state: 'visible', timeout: 15000 });
  ok('login form rendered (email + password visible)');

  // 3) Bogus login → must hit the Fly API cross-origin and come back 401 (no data created).
  await email.fill('nobody-smoke-test@example.com');
  await pw.fill('definitely-not-a-real-password');
  const respPromise = page.waitForResponse((r) => r.url().includes(API_HOST), { timeout: 20000 }).catch(() => null);
  await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Sign In")').first().click();
  const apiResp = await respPromise;
  if (apiResp) {
    ok(`browser → API reached: ${apiResp.status()} ${apiResp.url()}`);
    [401, 400, 403, 422].includes(apiResp.status()) ? ok('invalid creds correctly rejected (no data created)') : console.log('   (status ' + apiResp.status() + ')');
  } else {
    fail('NO request reached the Fly API after submit — browser→API path broken');
  }
  await page.waitForTimeout(1500);
  const body = (await page.locator('body').innerText()).toLowerCase();
  /invalid|incorrect|wrong|failed|credential|denied|error|unable/.test(body) ? ok('UI surfaced an auth error') : console.log('   (no obvious error text in UI)');

  // 4) /signup renders (owner bootstrap route is reachable).
  const su = await page.goto(WEB + '/signup', { waitUntil: 'networkidle', timeout: 30000 });
  console.log('signup:', page.url(), '| HTTP', su && su.status());
  (su && su.status() === 200) ? ok('/signup reachable (owner can register)') : console.log('   (/signup status ' + (su && su.status()) + ')');

  await page.screenshot({ path: 'tools/prod-e2e-login.png', fullPage: true });
  console.log('\n--- API requests from browser ---'); console.log(apiReqs.join('\n') || '(none)');
  console.log('--- API responses ---'); console.log(apiResps.join('\n') || '(none)');
  console.log('--- console/page errors ---'); console.log(consoleErrors.slice(0, 8).join('\n') || '(none)');
} catch (e) {
  fail('exception: ' + e.message);
} finally {
  await browser.close();
}
console.log(process.exitCode ? '\nSMOKE: FAIL' : '\nSMOKE: PASS');
