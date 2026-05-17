/**
 * PunchClock Pro — Playwright demo recorder.
 *
 * Walks the v2 surfaces with a visible cursor + smooth movement so the
 * recorded webm looks like a human is driving the mouse. No audio, no
 * narration — just clean motion through the flow.
 *
 * Output: docs/demo-video/walkthrough.webm  (and -mp4 if ffmpeg is on PATH)
 *
 * Prereqs:
 *   - Web on http://localhost:3000  (pnpm --filter @punchclock/web start)
 *   - API on http://localhost:4000  (pnpm --filter @punchclock/api dev)
 *   - Fresh seed                   (pnpm db:seed)
 *
 * Run:
 *   node tools/record-demo.mjs
 */
import { chromium } from 'playwright';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'docs', 'demo-video');
const VIEWPORT = { width: 1280, height: 800 };

const URLS = {
  web: process.env.WEB_URL ?? 'http://localhost:3000',
};

const CREDS = {
  owner: { email: 'owner@quickstop.test', password: 'Demo12345' },
  manager: { email: 'jordan.kim@quickstop.test', password: 'Demo12345' },
  employee: { email: 'alex.rivera@quickstop.test', password: 'Demo12345' },
};

// Injected on every document. Renders a small red cursor that follows
// real mouse events — Playwright's page.mouse fires DOM mousemove events,
// so the cursor stays in sync with what the test driver is "clicking".
const CURSOR_INJECT_SCRIPT = `
  (() => {
    if (window.__demoCursorReady) return;
    window.__demoCursorReady = true;
    const install = () => {
      if (!document.body) return setTimeout(install, 20);
      // Hide the Next.js dev indicator (and any tiny <nextjs-portal>) so
      // the recording doesn't show the "N" badge in the bottom-left.
      const css = document.createElement('style');
      css.textContent = [
        'nextjs-portal { display: none !important; }',
        '[data-nextjs-toast] { display: none !important; }',
        '#__next-build-watcher { display: none !important; }',
      ].join('\\n');
      document.head.appendChild(css);
      const el = document.createElement('div');
      el.id = '__demo_cursor';
      el.style.cssText = [
        'position: fixed',
        'top: 0', 'left: 0',
        'width: 18px', 'height: 18px',
        'border-radius: 50%',
        'background: rgba(220, 38, 38, 0.5)',
        'border: 2px solid white',
        'box-shadow: 0 0 0 1px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.25)',
        'pointer-events: none',
        'z-index: 2147483647',
        'transition: width 80ms ease, height 80ms ease, background 120ms ease',
        'transform: translate3d(-50%, -50%, 0)',
        'will-change: transform',
      ].join(';');
      document.body.appendChild(el);
      const move = (e) => {
        el.style.transform = 'translate3d(' + (e.clientX - 9) + 'px, ' + (e.clientY - 9) + 'px, 0)';
      };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mousedown', () => {
        el.style.width = '12px';
        el.style.height = '12px';
        el.style.background = 'rgba(220, 38, 38, 0.95)';
      }, true);
      document.addEventListener('mouseup', () => {
        el.style.width = '18px';
        el.style.height = '18px';
        el.style.background = 'rgba(220, 38, 38, 0.5)';
      }, true);
    };
    install();
  })();
`;

let cursorX = VIEWPORT.width / 2;
let cursorY = VIEWPORT.height / 2;

async function pause(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function smoothMoveTo(page, x, y, steps = 30) {
  await page.mouse.move(x, y, { steps });
  cursorX = x;
  cursorY = y;
}

async function smoothClick(page, locator, opts = {}) {
  const handle = typeof locator === 'string' ? page.locator(locator).first() : locator;
  await handle.waitFor({ state: 'visible', timeout: opts.timeout ?? 10000 });
  await handle.scrollIntoViewIfNeeded();
  await pause(200);
  const box = await handle.boundingBox();
  if (box) {
    await smoothMoveTo(page, box.x + box.width / 2, box.y + box.height / 2);
    await pause(opts.dwell ?? 350);
  }
  // Use the locator's click — fires a proper {mousedown, mouseup, click}
  // sequence that React / Next picks up. The smooth move above is what
  // the recording captures; this is the actual interaction.
  await handle.click({ delay: 80 });
  await pause(opts.after ?? 600);
}

async function hoverPause(page, locator, ms = 1400) {
  const handle = typeof locator === 'string' ? page.locator(locator).first() : locator;
  await handle.waitFor({ state: 'visible' });
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  if (!box) return;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await smoothMoveTo(page, x, y);
  await pause(ms);
}

async function typeInto(page, selector, text, delay = 55) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible' });
  const box = await loc.boundingBox();
  if (box) {
    await smoothMoveTo(page, box.x + box.width / 2, box.y + box.height / 2);
    await pause(200);
    await loc.click();
  }
  // Date / number inputs don't render character-at-a-time typing in a
  // way humans recognize — set them directly. Everything else gets the
  // visible typing animation.
  const type = await loc.evaluate((el) => (el instanceof HTMLInputElement ? el.type : ''));
  if (type === 'date' || type === 'number') {
    await loc.fill(text);
    await pause(250);
    return;
  }
  await loc.fill('');
  await loc.type(text, { delay });
  await pause(250);
}

async function login(page, role) {
  const creds = CREDS[role];
  await page.goto(`${URLS.web}/login`, { waitUntil: 'networkidle' });
  await pause(1200);
  await typeInto(page, 'input[type="email"]', creds.email);
  await typeInto(page, 'input[type="password"]', creds.password);
  await smoothClick(page, 'button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await pause(1500);
}

async function signOut(page) {
  await smoothClick(page, 'button:has-text("Sign out")');
  await page.waitForURL(/\/login/, { timeout: 10000 });
  await pause(800);
}

async function clickNav(page, label) {
  // Each nav link wraps {icon span}{label span}. Match the label span
  // exactly so "Schedule" doesn't snag "My Schedule" (substring trap).
  const loc = page
    .locator('aside nav a')
    .filter({ has: page.locator(`span:text-is(${JSON.stringify(label)})`) })
    .first();
  await smoothClick(page, loc, { after: 1200 });
}

async function takeShot(page, name) {
  const path = join(OUT_DIR, 'stills', `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function recordDemo() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(join(OUT_DIR, 'stills'), { recursive: true });

  // Clear any stale webm/mp4 leftovers so the renamer below picks the
  // file this run produced rather than a half-finished prior attempt.
  const stale = await readdir(OUT_DIR);
  for (const f of stale) {
    if (f.endsWith('.webm') || f === 'walkthrough.mp4') {
      await rm(join(OUT_DIR, f));
    }
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT_DIR, size: VIEWPORT },
  });
  await context.addInitScript(CURSOR_INJECT_SCRIPT);

  const page = await context.newPage();

  // -- Scene 1: Login as owner -----------------------------------
  console.log('▶ scene 1: owner login');
  await login(page, 'owner');

  // -- Scene 2: Overview + labor cost card ----------------------
  console.log('▶ scene 2: overview');
  await hoverPause(page, 'h1:has-text("Team overview")', 800);
  await hoverPause(page, 'text=Clocked in now', 1000);
  await hoverPause(page, 'text=Labor cost', 1600);
  await takeShot(page, '01-overview-owner');

  // -- Scene 3: Schedule + coverage map -------------------------
  console.log('▶ scene 3: schedule');
  await clickNav(page, 'Schedule');
  await pause(800);
  await hoverPause(page, 'button:has-text("Copy last week")', 1200);
  // Scroll down to show the coverage heatmap
  await page.mouse.wheel(0, 600);
  await pause(800);
  await hoverPause(page, 'h2:has-text("Coverage map")', 1500);
  await takeShot(page, '02-schedule-coverage');
  await page.mouse.wheel(0, -600);
  await pause(500);

  // -- Scene 4: Reports + export buttons ------------------------
  console.log('▶ scene 4: reports');
  await clickNav(page, 'Reports');
  await pause(1000);
  await hoverPause(page, 'button:has-text("QuickBooks (.iif)")', 1200);
  await hoverPause(page, 'button:has-text("QBO (.json)")', 1000);
  await takeShot(page, '03-reports-exports');

  // -- Scene 5: Settings (quick scroll) -------------------------
  console.log('▶ scene 5: settings');
  await clickNav(page, 'Settings');
  await pause(1000);
  await hoverPause(page, 'h2:has-text("Compliance + budget")', 1200);
  await page.mouse.wheel(0, 500);
  await pause(800);
  await hoverPause(page, 'h2:has-text("Punch verification")', 1500);
  await takeShot(page, '04-settings-verification');
  await page.mouse.wheel(0, -500);
  await pause(300);

  // -- Scene 6: Audit log ---------------------------------------
  console.log('▶ scene 6: audit log');
  await clickNav(page, 'Audit log');
  await pause(1500);
  await hoverPause(page, 'h1:has-text("Audit log")', 1500);
  await takeShot(page, '05-audit-log');

  // -- Scene 7: Preview-as Alex ---------------------------------
  console.log('▶ scene 7: preview-as');
  await clickNav(page, 'Preview as…');
  await pause(1000);
  await hoverPause(page, 'h1:has-text("Preview as worker")', 1000);
  await smoothClick(
    page,
    'button:has-text("Preview as Alex")',
    { after: 1500 },
  );
  // Wait for redirect + identity flip.
  await page.waitForURL(/\/dashboard$/, { timeout: 10000 });
  await pause(1500);
  await hoverPause(page, 'text=Previewing as', 1800);
  await takeShot(page, '06-preview-banner');

  // -- Scene 8: Employee view (shrunk sidebar) ------------------
  console.log('▶ scene 8: employee surfaces');
  await clickNav(page, 'My Timesheet');
  await pause(1500);
  await hoverPause(page, 'h1:has-text("My Timesheet")', 1200);
  await takeShot(page, '07-my-timesheet');

  await clickNav(page, 'Time off');
  await pause(1200);
  await hoverPause(page, 'h2:has-text("Request time off")', 1200);
  // Submit a request to demonstrate the flow.
  await typeInto(page, 'input[type="date"] >> nth=0', '2026-07-04');
  await typeInto(page, 'input[type="date"] >> nth=1', '2026-07-06');
  await typeInto(
    page,
    'input[placeholder*="Vacation"]',
    'Independence Day weekend',
  );
  await smoothClick(page, 'button:has-text("Submit request")', { after: 1800 });
  await hoverPause(page, 'h2:has-text("My requests")', 1500);
  await takeShot(page, '08-time-off-submitted');

  // -- Scene 9: Exit preview ------------------------------------
  console.log('▶ scene 9: exit preview');
  await smoothClick(page, 'button:has-text("Exit preview")', { after: 1500 });
  await pause(1200);

  // -- Scene 10: Switch to manager, approve TOR -----------------
  console.log('▶ scene 10: manager approves');
  await signOut(page);
  await login(page, 'manager');
  await clickNav(page, 'Time off');
  await pause(1500);
  await hoverPause(page, 'h2:has-text("Pending approvals")', 1200);
  // Approve the first pending request — owner-side ranking puts Alex on top.
  const approveBtn = page.locator('button:has-text("Approve")').first();
  if (await approveBtn.isVisible()) {
    await smoothClick(page, approveBtn, { after: 1800 });
  }
  await takeShot(page, '09-manager-approved');

  // -- Scene 11: Sign out ---------------------------------------
  console.log('▶ scene 11: sign out');
  await signOut(page);
  await hoverPause(page, 'h1:has-text("Sign in")', 800).catch(() => undefined);

  // Close everything so the video is finalized.
  await page.close();
  await context.close();
  await browser.close();

  // Find the just-recorded video and rename it.
  const files = await readdir(OUT_DIR);
  const webm = files.find((f) => f.endsWith('.webm'));
  if (!webm) throw new Error('no .webm output found');
  const renamed = join(OUT_DIR, 'walkthrough.webm');
  await rename(join(OUT_DIR, webm), renamed);

  const sz = (await stat(renamed)).size;
  console.log(`\nwrote ${renamed} (${Math.round(sz / 1024)} KB)`);

  // Convert to mp4 if ffmpeg is available — webm plays everywhere modern,
  // but mp4 is friendlier for embedding/sharing.
  try {
    const mp4 = join(OUT_DIR, 'walkthrough.mp4');
    await execFileP('ffmpeg', [
      '-y',
      '-i', renamed,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-movflags', '+faststart',
      mp4,
    ]);
    const sz2 = (await stat(mp4)).size;
    console.log(`wrote ${mp4} (${Math.round(sz2 / 1024)} KB)`);
  } catch (e) {
    console.log('skipped mp4 conversion:', e.message.slice(0, 120));
  }
}

recordDemo().catch(async (e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
