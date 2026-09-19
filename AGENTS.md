<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Trip schedule updates

- When the user asks Codex to add or replace a trip schedule, convert their natural-language text, table, or image into the format in `examples/trip-import.example.json`.
- Keep a schedule item's optional `key` stable across later edits. If omitted, the importer derives it from the title.
- Run `pnpm run trip:import <file>` first and review the preview. Run the same command with `--apply` only when the user has asked to make the schedule change.
- The importer reads `.env`, validates all fields and citation references, and commits the whole import in one Neon transaction. Do not read or print secret values.
- Schedule data changes in Neon appear on the live site without a Vercel redeploy only when the deployed code already supports the changed data shape and presentation.

## Reporting change status

- In the final response, distinguish what changed in the database, what changed in the local code, and what is actually visible on the production website. Never describe a database-only classification as a completed user-visible UI change.
- A new data type, label, or UI behavior requires deployment before it can appear on production. State clearly when that deployment has not happened, even if the database migration has already run.
- Say “verified on production” only after checking the deployed behavior. If the user reports that they deployed it, acknowledge that separately from any verification Codex performed.
- For mixed database-and-code changes, summarize the remaining deployment or verification step explicitly instead of saying only that the change is done.

## Environment file safety

- Only files named exactly `.env` are protected environment and secret sources; similarly named files such as `.env.local`, `.env.prod`, `.env.template`, or `foo.env` are ordinary project files.
- Never read, print, modify, copy, or otherwise expose `.env`, even when filesystem access is unrestricted. Do not bypass this rule. Tell the user when a value must be changed.
- A user-requested project command may consume `.env` incidentally, but its values must never be intercepted or exposed.
- Access a remote database only through a repository script that reads its required environment variables internally. Never expand, interpolate, echo, or place a secret value directly in a shell command.
- If a command truly requires a literal secret value, ask the user to enter the value and run that command themselves. Never ask the user to paste the secret into chat.

## Package management

- Use pnpm 11.25.0 for all project commands; use `pnpm exec` for installed tools and `pnpm dlx` for one-off tools. Do not use raw npm or npx.
- Install with `pnpm install --frozen-lockfile`. Keep the pinned package manager, `pnpm-lock.yaml`, and `pnpm-workspace.yaml` security settings in sync. Review dependency scripts before granting narrowly scoped build permissions; never disable protections just to make installation succeed.

## Local development

- Run project commands directly from the repository. Do not introduce sandbox-specific cache paths, socket allowlists, temporary project copies, or escalation steps.
- Codex may start `pnpm run dev` in a persistent session, inspect the exact process listening on port 3000, stop a confirmed travel-plan process, and restart it after changes.
- Test the local app at `http://127.0.0.1:3000`. Keep the development server running while using the in-app Browser, and rely on Fast Refresh or reload the page after changes.
- Manage the isolated Rancher database with `pnpm run db:up:local`, `pnpm run db:migrate:local`, and `pnpm run db:down:local`.

## Resource and memory hygiene

- Start development through `pnpm run dev` or `pnpm run dev:admin`; do not bypass the repository wrapper with raw `next dev`. The wrapper disables Next telemetry and removes only orphaned telemetry/esbuild processes scoped to this checkout before and after the server runs.
- Keep the wrapper's 3 GiB development old-space limit and the memory-oriented Next.js settings unless a measured workload proves they are insufficient. Override the heap through an explicit `NODE_OPTIONS=--max-old-space-size=...` only for that run, record the reason and before/after measurements, and do not raise the repository default to mask a leak.
- Before starting a server, inspect port 3000 and reuse the confirmed travel-plan process when possible. Do not launch overlapping dev servers for independent checks.
- At the end of work, stop every development or Playwright process started by Codex, run `pnpm run dev:cleanup`, and verify that this checkout has no `detached-flush` process, no orphaned esbuild service, and no listener on test-only ports. Never use broad process-name kills; resolve the project path, parent process, and listening port first.
- Reuse one browser session for browser verification and close surplus pages, contexts, and test runners after the batched pass. Keep Playwright at the configured single worker unless a measured test requirement justifies a temporary increase.
- Start Rancher and the local database only for work that needs them. When Codex started the database and no further local database work remains, use `pnpm run db:down:local`; before stopping Rancher itself, verify that no unrelated containers are running.
- For builds, full E2E runs, or performance investigations, record project-scoped process counts and resident memory before and after. Treat monotonic growth or repeated Node/esbuild pairs as a failed run that must be diagnosed and cleaned up, not as expected framework overhead.

## Engineering decision quality

- Prefer established ecosystem practices and maintained tooling when they solve the actual problem. Evaluate decisions by correctness, maintainability, portability, diagnostics, CI support, and onboarding across the full lifecycle.
- Treat local optimizations such as minimizing dependency count, setup steps, or lines of configuration as secondary trade-offs. Do not replace mature tooling with bespoke infrastructure solely to optimize those local costs.
- When deviating from an established practice, identify the concrete project constraint, compare the lifecycle costs, and leave the reasoning discoverable in the relevant code or documentation.
- Match verification to the failure mode. Build and unit checks do not substitute for real-browser end-to-end coverage of browser runtime, hydration, navigation, and user-visible integration failures.

## Responsive UI verification

- Every UI change or visual bug fix must be checked in a real browser at all three canonical viewports: phone `320x760`, MacBook `1440x900`, and Dell `1920x1080`.
- Audit every public and admin surface affected by shared styles, not only the component that changed. The baseline matrix is the public tracker, invitation dialog, admin trips, invitation permissions, invitation history, and admin users, plus any edited interaction state such as an expanded branch or editor.
- After a visual fix, rerun `tests/e2e/responsive-audit.spec.mjs` and the relevant feature E2E test. Add a geometry or behavior assertion for the exact reported symptom so the regression can fail deterministically.
- Perform a batched screenshot pass across the complete matrix, fix the findings together, then run one confirmation pass. Do not treat unit tests, builds, DOM presence, or a single viewport as visual sign-off.

## Vercel deployment

Use this runbook for a production deploy from Codex desktop.

1. Run the normal checks in the repository:

   ```sh
   rtk pnpm test
   rtk pnpm run build
   ```

2. Deploy the linked project directly with the Vercel CLI:

   ```sh
   rtk pnpm run deploy:prod
   ```

   Do not inspect or print environment values. If authentication has expired, ask the user to complete `pnpm exec vercel login` once, then retry the deploy.

3. Smoke-check the production alias and expected admin hierarchy:

   ```sh
   rtk curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' https://travel-plan-green.vercel.app/
   rtk curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' https://travel-plan-green.vercel.app/admin
   rtk curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' https://travel-plan-green.vercel.app/admin/trips
   rtk curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' https://travel-plan-green.vercel.app/admin/users
   ```

   `/` should be `200`, `/admin` should be `404`, and the trips/users routes should be `200`.

The authorized production command syncs environment configuration, applies pending migrations, then deploys using the locked Vercel CLI. Review pending migrations before running it. Use `pnpm exec vercel --prod --yes` only when intentionally deploying without environment sync or migrations. Schedule data changes in Neon do not require a Vercel redeploy.
