# Bootstrap-signup web UI — design

**Date:** 2026-05-08
**Project:** PunchClock Pro (internal-use scope)
**Status:** Approved, ready for implementation plan

## Goal

Add a one-time bootstrap-signup page to the Next.js web app so the first
admin can be created in the browser instead of via `curl`. Bundle two
adjacent navigation fixes that fall out of the same change.

## Scope

In scope:

- New `/signup` route — client component mirroring the `/login` pattern
- Repoint the existing "Bootstrap your organization" link on `/login`
  (currently points at `/`) to `/signup`
- Replace `/` (marketing landing) with a server-side `redirect('/login')`
- Add Vitest infrastructure to `packages/web` (currently has none) and a
  full-coverage unit test for the new page

Out of scope (flagged as follow-ups):

- Redirecting already-authenticated users away from `/login`
- Live-testing the full flow in a browser (separate session)
- Mobile-equivalent bootstrap flow

## API contract (already shipped)

`POST /auth/signup` — accepts `signupRequestSchema` from
`@punchclock/shared`:

| Field             | Required | Notes                              |
| ----------------- | -------- | ---------------------------------- |
| organizationName  | yes      | 1-255 chars                        |
| ownerEmail        | yes      | email                              |
| ownerPassword     | yes      | 8-128 chars                        |
| ownerFirstName    | no       | 1-100 chars                        |
| ownerLastName     | no       | 1-100 chars                        |
| timezone          | no       | defaults to 'UTC'                  |
| industry          | no       | max 64 chars                       |

- Success (201): `{ token, organizationId, userId }`
- Already bootstrapped (403): `error.code === 'FORBIDDEN'`,
  message "Bootstrap signup is only available before any organization
  exists"

## Architecture & file layout

```
packages/web/
├── src/app/
│   ├── page.tsx                   # MODIFIED — replace marketing landing with redirect('/login')
│   ├── login/page.tsx             # MODIFIED — link href "/" → "/signup"
│   └── signup/
│       └── page.tsx               # NEW — client component
├── tests/
│   └── unit/
│       └── signup-page.test.tsx   # NEW — full coverage
├── vitest.config.ts               # NEW — jsdom env + @ alias
├── vitest.setup.ts                # NEW — jest-dom matchers + cleanup
└── package.json                   # MODIFIED — devDeps for jsdom + jest-dom + user-event
```

Test layout (`tests/unit/`) mirrors `packages/mobile`. Path alias `@/` →
`src/` matches the existing `tsconfig`.

## Component design

`packages/web/src/app/signup/page.tsx` — `'use client'` component,
mirrors `/login` pattern (chosen approach A; rejected B server-action
and C react-hook-form for divergence and dependency cost).

State (all `useState`):

- `organizationName`, `firstName`, `lastName`, `email`, `password`,
  `passwordConfirm`
- `error: string | null`
- `submitting: boolean`

Layout matches `/login`:

- `min-h-screen items-center justify-center bg-gradient-to-b from-brand-50 to-white p-6`
- Card: `w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 shadow-sm`
  (one size up from login's `max-w-sm` for the additional fields)
- Heading: "Create your organization"
- Subtitle: "One-time setup — first user becomes the owner."
- Submit button: "Create organization" / "Creating…"
- Footer: "Already set up? [Sign in]" → `/login`

Field order with `autoComplete` hints:

1. Organization name (`organization`)
2. First name (`given-name`)
3. Last name (`family-name`)
4. Email (`email`, `type="email"`)
5. Password (`new-password`, `type="password"`, `minLength={8}`)
6. Confirm password (`new-password`, `type="password"`, `minLength={8}`)

All required (browser-native validation handles required + email format
+ minLength).

## Data flow & error handling

```ts
async function onSubmit(e) {
  e.preventDefault();
  setError(null);

  if (password !== passwordConfirm) {
    setError('Passwords do not match');
    return;
  }

  setSubmitting(true);
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
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
```

Notes:

- `apiClient` already throws an `Error` with `.code === payload.error.code`
  (see `packages/web/src/lib/api-client.ts:21-25`).
- Import `ERROR_CODES` from `@punchclock/shared` rather than hardcoding
  `'FORBIDDEN'`.
- `Intl.DateTimeFormat` fallback to `'UTC'` covers oddball environments
  and keeps tests deterministic.
- On success, `setToken` writes the `pc_token` cookie via
  `document.cookie`. The dashboard server layout reads that same cookie
  via `cookies().get('pc_token')` on the next render. No race because
  `router.replace('/dashboard')` triggers a fresh navigation that
  re-runs the layout server-side after the cookie is written.

## Adjacent fixes

### Fix 1 — repoint login → signup link

`packages/web/src/app/login/page.tsx:79`:

```diff
- <Link href="/" className="text-brand-700 hover:underline">
+ <Link href="/signup" className="text-brand-700 hover:underline">
```

### Fix 2 — replace `/` with redirect

`packages/web/src/app/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

export default function HomePage() {
  redirect('/login');
}
```

Server component (no `'use client'`) so the redirect happens before any
HTML is sent. Already-authenticated users on `/login` see the form
again — known existing quirk, deferred.

## Testing

### Test infrastructure (new — none currently exists in `packages/web`)

`packages/web/vitest.config.ts`:

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

`packages/web/vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
afterEach(() => cleanup());
```

`packages/web/package.json` — add devDeps:

- `jsdom@^24.0.0`
- `@testing-library/jest-dom@^6.4.0`
- `@testing-library/user-event@^14.5.0`

### Test file — `packages/web/tests/unit/signup-page.test.tsx`

Mocks:

- `next/navigation` → fake `useRouter` exposing a `replace` spy
- `global.fetch` → controlled per case
- Optional: stub `Intl.DateTimeFormat().resolvedOptions().timeZone`

Cases:

1. **Happy path** — fill all fields, fetch resolves with success envelope:
   - `fetch` called with `/auth/signup` and JSON body containing all
     fields including resolved `timezone`
   - `document.cookie` contains `pc_token=<token>`
   - `router.replace('/dashboard')` called
2. **Already bootstrapped (403)** — fetch resolves with
   `{ success: false, error: { code: 'FORBIDDEN', message: '…' } }`:
   - Renders "An organization is already set up. Please sign in instead."
   - Footer "Sign in" link points to `/login`
   - `router.replace` not called
   - No `pc_token` cookie set
3. **Password mismatch** — `password !== passwordConfirm`:
   - "Passwords do not match" rendered
   - `fetch` not called
   - `router.replace` not called

### Verification

Run from repo root after `pnpm install`:

```
pnpm --filter @punchclock/web typecheck
pnpm --filter @punchclock/web test
pnpm --filter @punchclock/web build
```

Manual verification (separate session — flagged as follow-up):

1. Fresh DB, run API + web dev servers
2. Visit `/` → expect redirect to `/login`
3. Click "Bootstrap your organization" on `/login` → expect `/signup`
4. Submit valid form → expect dashboard
5. Submit again → expect "An organization is already set up" message

## Decisions log

| Decision                                | Rationale                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Approach A (client component)           | Matches `/login`; smallest delta; no new runtime deps                                              |
| Skip industry field                     | Optional in API; never displayed anywhere user-facing                                              |
| Auto-detect timezone                    | More accurate than asking user to pick from a list                                                 |
| Include first/last name                 | Rendered in `/dashboard/team`; without them the founding owner is nameless                         |
| Include password-confirm field          | One-time bootstrap; cost of a typo lockout is high                                                 |
| Let the form fail on already-bootstrapped | Avoids new GET endpoint for a one-shot flow                                                        |
| Replace `/` with redirect to `/login`   | Marketing landing is dead now; removes a confusing dead-end                                        |
| Punt `/login` auth-redirect quirk       | Existing pre-change behavior; not a regression of this work                                        |
| Add full-coverage test (3 cases)        | Web has zero tests today; this establishes the pattern + verifies the failure modes                |
| Vitest config + jsdom in `packages/web` | Required for any web test; best invested now since we'll add more web tests in future sessions     |
