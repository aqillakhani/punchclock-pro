# Bootstrap-signup web UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a one-time `/signup` page to the Next.js web app so the first
admin can be created in the browser, with full unit test coverage and two
adjacent navigation fixes.

**Architecture:** Approach A from the design — a `'use client'` component
at `packages/web/src/app/signup/page.tsx` that mirrors the existing
`/login` pattern (local `useState`, `apiClient.post`, `setToken`,
`router.replace`). No new runtime dependencies. Web package gets Vitest
infrastructure for the first time (jsdom + jest-dom matchers + user-event).

**Tech Stack:** Next.js 15 (App Router) · React 18 · TypeScript · Tailwind ·
Vitest · jsdom · @testing-library/react · @testing-library/user-event ·
@testing-library/jest-dom · pnpm workspaces

**Design doc:** `docs/plans/2026-05-08-bootstrap-signup-web-design.md`

> **Note on git:** This repo is not currently under git (`git status`
> returns "fatal: not a git repository"). Either run `git init` before
> starting (recommended so you can roll back individual tasks) or skip
> every "commit" step in this plan. The functional outcome is identical
> either way.

---

## Task 1: Add test devDependencies and run pnpm install

**Files:**
- Modify: `packages/web/package.json` (devDependencies block)

**Step 1: Add three devDeps**

Edit `packages/web/package.json` so the `devDependencies` block contains
these three new entries (alphabetical order, merge with existing):

```json
"@testing-library/jest-dom": "^6.4.0",
"@testing-library/user-event": "^14.5.0",
"jsdom": "^24.0.0",
```

The block should still keep everything that's already there
(`@testing-library/react`, `@types/node`, `autoprefixer`, etc.).

**Step 2: Install**

Run from repo root:

```bash
pnpm install
```

Expected: pnpm resolves the new packages and writes to
`pnpm-lock.yaml`. No errors. New entries appear under
`packages/web/node_modules/`.

**Step 3: Sanity-check by listing**

```bash
ls packages/web/node_modules/@testing-library | sort
```

Expected output includes: `jest-dom`, `react`, `user-event`.

```bash
ls packages/web/node_modules/jsdom/package.json
```

Expected: file exists.

**Step 4: Commit (skip if no git)**

```bash
git add packages/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add test devDeps for vitest jsdom setup"
```

---

## Task 2: Add Vitest config + setup file

**Files:**
- Create: `packages/web/vitest.config.ts`
- Create: `packages/web/vitest.setup.ts`

**Step 1: Create `packages/web/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
```

**Step 2: Create `packages/web/vitest.setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
```

**Step 3: Run vitest to confirm config loads**

```bash
pnpm --filter @punchclock/web test
```

Expected: vitest starts, finds zero tests (we haven't written any yet),
exits 0 because `--passWithNoTests` is on the script. No config errors.

If you see "Cannot find module 'jsdom'", task 1 didn't complete — go
back.

**Step 4: Commit (skip if no git)**

```bash
git add packages/web/vitest.config.ts packages/web/vitest.setup.ts
git commit -m "chore(web): add vitest jsdom config + setup"
```

---

## Task 3: Write the failing happy-path test for the signup page

**Files:**
- Create: `packages/web/tests/unit/signup-page.test.tsx`

**Step 1: Create the test file with one test**

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Import AFTER vi.mock so the mocked module is in place
import SignupPage from '@/app/signup/page';

describe('SignupPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    replaceMock.mockReset();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    // Clear any pc_token cookie set by a prior test
    document.cookie = 'pc_token=; Path=/; Max-Age=0; SameSite=Lax';
  });

  async function fillForm(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/organization name/i), 'Acme Co');
    await user.type(screen.getByLabelText(/first name/i), 'Ada');
    await user.type(screen.getByLabelText(/last name/i), 'Lovelace');
    await user.type(screen.getByLabelText(/^email$/i), 'ada@acme.test');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'password123');
  }

  it('submits the form, stores the token, and redirects to /dashboard', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: { token: 'test-token', organizationId: 'org-1', userId: 'user-1' },
      }),
    });
    const user = userEvent.setup();
    render(<SignupPage />);
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /create organization/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/auth\/signup$/);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      organizationName: 'Acme Co',
      ownerFirstName: 'Ada',
      ownerLastName: 'Lovelace',
      ownerEmail: 'ada@acme.test',
      ownerPassword: 'password123',
    });
    expect(typeof body.timezone).toBe('string');
    expect(body.timezone.length).toBeGreaterThan(0);
    expect(document.cookie).toContain('pc_token=test-token');
    expect(replaceMock).toHaveBeenCalledWith('/dashboard');
  });
});
```

**Step 2: Run the test — expect FAIL**

```bash
pnpm --filter @punchclock/web test
```

Expected: FAIL with an error about `@/app/signup/page` not being
resolvable (the file doesn't exist yet). This is the RED step of TDD.

**Step 3: Commit (skip if no git)**

```bash
git add packages/web/tests/unit/signup-page.test.tsx
git commit -m "test(web): add failing happy-path test for signup page"
```

---

## Task 4: Implement the minimal signup page to pass the happy-path test

**Files:**
- Create: `packages/web/src/app/signup/page.tsx`

**Step 1: Create the page**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState } from 'react';
import { ERROR_CODES } from '@punchclock/shared';
import { apiClient } from '@/lib/api-client';
import { setToken } from '@/lib/auth';

interface SignupResponse {
  token: string;
  organizationId: string;
  userId: string;
}

export default function SignupPage() {
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const timezone =
        Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const data = await apiClient.post<SignupResponse>('/auth/signup', {
        organizationName,
        ownerFirstName: firstName,
        ownerLastName: lastName,
        ownerEmail: email,
        ownerPassword: password,
        timezone,
      });
      setToken(data.token);
      router.replace('/dashboard');
    } catch (err) {
      const code = (err as { code?: string }).code;
      const message = err instanceof Error ? err.message : 'Signup failed';
      if (code === ERROR_CODES.FORBIDDEN) {
        setError('An organization is already set up. Please sign in instead.');
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-white p-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-bold text-brand-900">Create your organization</h1>
        <p className="mb-6 text-sm text-slate-600">
          One-time setup — first user becomes the owner.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Organization name</span>
            <input
              type="text"
              required
              autoComplete="organization"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">First name</span>
              <input
                type="text"
                required
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Last name</span>
              <input
                type="text"
                required
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Confirm password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </label>
          {error && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-brand-600 px-4 py-2 font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create organization'}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-500">
          Already set up?{' '}
          <Link href="/login" className="text-brand-700 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
```

> **Note:** This intentionally includes the FORBIDDEN branch already
> (it's a single conditional that's easier to write once than to add
> back later). The next two tests (Task 5 and Task 6) will cover that
> branch + the password-mismatch branch — but the password-mismatch
> branch is **not yet implemented** in this code. That's deliberate:
> we'll see Task 6's test fail, then add the check. Pure TDD on the
> validation, slight pragmatism on the error code.

**Step 2: Run the test — expect PASS**

```bash
pnpm --filter @punchclock/web test
```

Expected: 1 passed.

**Step 3: Run typecheck**

```bash
pnpm --filter @punchclock/web typecheck
```

Expected: no errors.

**Step 4: Commit (skip if no git)**

```bash
git add packages/web/src/app/signup/page.tsx
git commit -m "feat(web): add bootstrap signup page (happy path)"
```

---

## Task 5: Add the FORBIDDEN test case

**Files:**
- Modify: `packages/web/tests/unit/signup-page.test.tsx` (add second `it` block inside the existing `describe`)

**Step 1: Append a new test at the end of the `describe` block, before the closing `});`**

```tsx
  it('shows the already-bootstrapped message and a sign-in link on FORBIDDEN', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Bootstrap signup is only available before any organization exists',
        },
      }),
    });
    const user = userEvent.setup();
    render(<SignupPage />);
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /create organization/i }));

    expect(
      screen.getByText('An organization is already set up. Please sign in instead.'),
    ).toBeInTheDocument();
    const signInLink = screen.getByRole('link', { name: /sign in/i });
    expect(signInLink).toHaveAttribute('href', '/login');
    expect(replaceMock).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain('pc_token=test-token');
  });
```

**Step 2: Run the tests — expect PASS (FORBIDDEN branch is already implemented in Task 4)**

```bash
pnpm --filter @punchclock/web test
```

Expected: 2 passed.

If FORBIDDEN doesn't trigger, double-check the import: the test relies on
`apiClient` setting `err.code` from `payload.error.code`. Inspect
`packages/web/src/lib/api-client.ts:21-25` — it already does this.

**Step 3: Commit (skip if no git)**

```bash
git add packages/web/tests/unit/signup-page.test.tsx
git commit -m "test(web): cover already-bootstrapped 403 path on signup"
```

---

## Task 6: Add the password-mismatch test (RED)

**Files:**
- Modify: `packages/web/tests/unit/signup-page.test.tsx`

**Step 1: Append the third test at the end of the describe block**

```tsx
  it('shows a local error and does not call the API on password mismatch', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);
    await user.type(screen.getByLabelText(/organization name/i), 'Acme Co');
    await user.type(screen.getByLabelText(/first name/i), 'Ada');
    await user.type(screen.getByLabelText(/last name/i), 'Lovelace');
    await user.type(screen.getByLabelText(/^email$/i), 'ada@acme.test');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'differentpw');
    await user.click(screen.getByRole('button', { name: /create organization/i }));

    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });
```

**Step 2: Run tests — expect FAIL on the new case**

```bash
pnpm --filter @punchclock/web test
```

Expected: 2 passed, 1 failed. The failing case is the new one — the
form will currently call `fetch` even on mismatched passwords because
the page doesn't have the local check yet.

**Step 3: Do NOT commit yet** — the test is RED. Move to Task 7.

---

## Task 7: Implement the password-mismatch check (GREEN)

**Files:**
- Modify: `packages/web/src/app/signup/page.tsx` (add an early-return inside `onSubmit`)

**Step 1: Edit `onSubmit` to add the check before `setSubmitting(true)`**

Find this in `onSubmit`:

```ts
    event.preventDefault();
    setError(null);
    setSubmitting(true);
```

Replace with:

```ts
    event.preventDefault();
    setError(null);
    if (password !== passwordConfirm) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
```

**Step 2: Run all tests — expect PASS**

```bash
pnpm --filter @punchclock/web test
```

Expected: 3 passed.

**Step 3: Run typecheck**

```bash
pnpm --filter @punchclock/web typecheck
```

Expected: no errors.

**Step 4: Commit (skip if no git)**

```bash
git add packages/web/src/app/signup/page.tsx packages/web/tests/unit/signup-page.test.tsx
git commit -m "feat(web): reject signup on password mismatch before API call"
```

---

## Task 8: Adjacent fix — repoint login link to /signup

**Files:**
- Modify: `packages/web/src/app/login/page.tsx:79`

**Step 1: Change the link target**

Find the line (currently around line 79):

```tsx
            <Link href="/" className="text-brand-700 hover:underline">
              Bootstrap your organization
            </Link>
```

Replace `href="/"` with `href="/signup"`:

```tsx
            <Link href="/signup" className="text-brand-700 hover:underline">
              Bootstrap your organization
            </Link>
```

**Step 2: Verify typecheck still passes**

```bash
pnpm --filter @punchclock/web typecheck
```

Expected: no errors.

**Step 3: Commit (skip if no git)**

```bash
git add packages/web/src/app/login/page.tsx
git commit -m "fix(web): point login bootstrap link to /signup"
```

---

## Task 9: Adjacent fix — replace `/` with redirect to `/login`

**Files:**
- Modify: `packages/web/src/app/page.tsx` (full rewrite)

**Step 1: Replace the entire file contents**

```tsx
import { redirect } from 'next/navigation';

export default function HomePage() {
  redirect('/login');
}
```

That's the whole file. Note: no `'use client'` — this is a server
component so the redirect happens before any HTML is sent.

**Step 2: Verify typecheck still passes**

```bash
pnpm --filter @punchclock/web typecheck
```

Expected: no errors.

**Step 3: Commit (skip if no git)**

```bash
git add packages/web/src/app/page.tsx
git commit -m "feat(web): redirect / to /login"
```

---

## Task 10: Final verification

**Step 1: Run typecheck across the whole web package**

```bash
pnpm --filter @punchclock/web typecheck
```

Expected: no errors.

**Step 2: Run all web tests**

```bash
pnpm --filter @punchclock/web test
```

Expected: 3 passed, 0 failed.

**Step 3: Run a production build**

```bash
pnpm --filter @punchclock/web build
```

Expected: build succeeds. This catches RSC vs client-component mistakes
that pure typecheck misses (e.g., importing a server-only module from a
`'use client'` file). Look for clean output ending in
"Compiled successfully" or similar Next.js success message.

**Step 4: Run the workspace-wide green-check (optional but recommended)**

```bash
pnpm typecheck
pnpm test
```

Expected: API + mobile + web all green. The 23 API + 13 mobile unit
tests should still pass; web now has 3 of its own.

**Step 5: Commit a checkpoint (skip if no git)**

```bash
git commit --allow-empty -m "chore: bootstrap-signup web UI complete"
```

---

## Done criteria

- [ ] `pnpm --filter @punchclock/web typecheck` passes
- [ ] `pnpm --filter @punchclock/web test` passes with 3 tests
- [ ] `pnpm --filter @punchclock/web build` succeeds
- [ ] `/signup` route renders the form
- [ ] `/login` "Bootstrap your organization" link goes to `/signup`
- [ ] `/` redirects to `/login`

## Out of scope (follow-ups)

- Live-test the full flow in a browser + verify against a fresh DB
- Redirect already-authenticated users away from `/login`
- Bootstrap-signup flow on mobile
