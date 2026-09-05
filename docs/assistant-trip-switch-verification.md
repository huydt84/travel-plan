# Local trip-switch acceptance — 2026-09-05

The local preview at `http://127.0.0.1:3000` now has the original Kamakura trip and
`kyoto-local-assistant` (Kyoto · thử trợ lý). The latter is a deliberately fictional
three-activity example imported from `examples/local-kyoto-assistant.json` using
`trip:import:local`, previewed before applying. Both trips remain available.
Production data and deployment were not changed.

## What was exercised

- Normal browser submission, actual Vercel Workflow dispatch and a streamed partial
  reply. After selecting the other trip, the database must still say `running`.
  After closing chat, it must still say `running`. The completed answer must then
  contain more text than the snapshot taken after switching.
- Returning to the original conversation and reloading restores the answer and trip;
  the other trip's draft stays separate. This exact scenario passed three repeated
  runs against the retained trips, followed by a final confirmation run.
- Two accepted submissions get different conversations and different, claimed
  Workflow identities. Both must still be `running` while viewing Kyoto. Clicking
  Stop in Kyoto records `TURN_CANCELLED`; the other trip completes without a viewer.
  Kyoto's partial output remains unchanged, no proposal is published, and both
  itineraries are byte-for-byte unchanged in the database snapshot comparison.
- Draft restoration, selected conversation restoration, browser runtime health and
  horizontal geometry at 320×760, 1440×900 and 1920×1080. Screenshots were inspected.

These are real Workflow and database tests using the **simulated local model**.
No worker claims, text events or terminal results are fabricated by the new local
acceptance test. This run does not establish live Gemini response quality or timing.
The simulated response lasts less than a second; the assertions deliberately fail
if navigation is too slow to observe the active execution. No retry converts that
case into a success.

## Reproduce

Start the admin preview with `AGENTIC_V1_ENABLED=true` and
`APP_URL=http://127.0.0.1:3000`. Import the example locally if it is absent. Then:

```sh
E2E_BASE_URL=http://127.0.0.1:3000 E2E_LOCAL_TRIP_SWITCH=true pnpm exec playwright test tests/e2e/assistant-companion.spec.mjs tests/e2e/assistant-local-switch.spec.mjs
```

The explicit local acceptance flag retains its conversations for manual inspection
and uses the normal per-user request quota. Without that flag, the companion suite
uses disposable trips and the retained-trip acceptance suite is skipped.

Final result: **12 browser tests passed**, **140 unit tests passed**, lint passed.
No application implementation change was needed for these scenarios. The original
background test was strengthened to check the specific run's persisted state, not
just a visible Stop button or an arbitrary historical conversation's status.

Local evidence is saved in `.impeccable/review/trip-switch/`: per-viewport execution
snapshots (including run and workflow identities), screenshots, and
`close-and-return.json`. This ignored artifact directory stays on the machine;
the regression tests and this runbook are repository files.
