# Demo recording

A scripted Playwright walkthrough of the v2 dashboard. No audio, no
narration — just the cursor moving through the flow at a watchable
pace.

## Files

| File | Size | Notes |
|---|---|---|
| `walkthrough.mp4` | ~2.3 MB | h264, 1280×800 @ 25 fps, ~117 s. Recommended for sharing / embedding. |
| `walkthrough.webm` | ~7.7 MB | Native Playwright output. Higher bitrate, plays in all modern browsers. |
| `stills/` | — | Key-frame stills from each scene, also embeddable in docs. |

## Scene order (≈2 min total)

1. Owner sign-in
2. Overview — labor cost card (red because over budget)
3. Schedule — coverage heatmap + Copy last week button
4. Reports — CSV + QuickBooks .iif + QBO .json export buttons
5. Settings — compliance + verification sections
6. Audit log — cap_blocked entry from seed
7. Preview as… → preview as Alex Rivera (employee)
8. Employee surfaces (sidebar shrinks) — My Timesheet, Time off (submit a request)
9. Exit preview banner
10. Sign in as Jordan Kim (manager) → Time off → approve the pending request
11. Sign out

## Re-recording

```
pnpm db:seed                              # fresh demo data
pnpm --filter @punchclock/web dev         # web on :3000
pnpm --filter @punchclock/api dev         # api on :4000
node tools/record-demo.mjs                # writes walkthrough.webm + .mp4
```

The recorder injects a small red cursor div + smooths every mouse
movement with 30 interpolated steps; it also hides the Next.js dev
indicator so the video looks like production. No real source files
are modified — everything is browser-side.

## Known limits

- 1280×800 viewport (browser chrome included by Playwright video).
- 25 fps (Playwright's default). Smooth enough; cursor motion is the
  bottleneck on lower fps.
- Some scenes show the schedule with last week's data because the
  recorder lands "this week" in the middle of seeded shifts.
