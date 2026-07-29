# Getting a worker signed in

## The two ways

**Leave the password blank (recommended).** The worker chooses their own password and nobody
else ever knows it. The Team screen shows you a one-time sign-in link — send it however you
like. If email is configured it is also emailed automatically.

**Set an initial password.** You type one, you tell the worker, they can change it later via
*Forgot password*. Simpler, but you know their password.

## Why the link is shown on screen

Email delivery is optional in this product. With no mail provider configured, `sendEmail`
falls back to a log transport that "succeeds" without sending anything — so an invite would
vanish into a log line, the token would expire, and the worker could never sign in with no
indication anything was wrong. That is exactly what happened on the production install
before 2026-07-29.

So the link is always returned to the person who created the account. They already control
that account, so seeing it grants them nothing extra. The panel states plainly whether the
email actually went out.

## If someone is stuck

The Team list shows **No password set** against anyone who hasn't chosen one. Use
**Get sign-in link** on that row to generate a fresh link — old ones expire after 7 days and
are single-use.

Re-inviting somebody who *already has* a password is refused on purpose: it would let an
owner hand out a link that silently overwrites a working credential. They should use
*Forgot password* instead, which they start themselves.

## Turning on real email

Invites, password resets, and time-off/correction notifications all go out once a provider
is configured. Without it they are logged and not sent.

```bash
# 1. Create a Resend account and verify the sending domain.
# 2. Point EMAIL_FROM at an address on that domain.
flyctl secrets set \
  EMAIL_PROVIDER=resend \
  RESEND_API_KEY=re_... \
  EMAIL_FROM='PunchClock Pro <no-reply@yourdomain.com>' \
  -a punchclock-api
```

`assertProductionReady` refuses to boot with `EMAIL_PROVIDER=resend` and no
`RESEND_API_KEY`, so a half-finished configuration fails loudly at startup rather than
silently swallowing mail.

Verify by adding a user with the password left blank — the Team panel should then read
"We emailed this to them" instead of "Email delivery is not set up".

## Token lifetimes

| Token | TTL | Why |
| --- | --- | --- |
| Password reset | 15 minutes | Requested by someone sitting at their inbox; a short window limits a stolen link. |
| Invite / setup | 7 days | The owner adds staff whenever it suits them and the worker may not read email until their next shift. |

Both are single-use, and only a SHA-256 hash is stored — a database leak exposes no usable
links.

## Tests

- `packages/api/tests/integration/invite-flow.test.ts` — runs with email **off**, covering
  create → link → set password → log in, re-issue after expiry, and the refusals.
- `tools/e2e-invite.mjs` — a real browser doing the same from the Team screen.
