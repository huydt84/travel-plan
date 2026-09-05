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
- Schedule data changes in Neon appear on the live site without a Vercel redeploy.

## Environment file safety

- Only files named exactly `.env` are protected environment and secret sources; similarly named files such as `.env.local`, `.env.prod`, `.env.template`, or `foo.env` are ordinary project files.
- Never read, print, modify, copy, or otherwise expose `.env`, even when filesystem access is unrestricted. Do not bypass this rule. Tell the user when a value must be changed.
- A user-requested project command may consume `.env` incidentally, but its values must never be intercepted or exposed.
- Access a remote database only through a repository script that reads its required environment variables internally. Never expand, interpolate, echo, or place a secret value directly in a shell command.
- If a command truly requires a literal secret value, ask the user to enter the value and run that command themselves. Never ask the user to paste the secret into chat.

## Package management

- Use pnpm 11.19.0 for all project commands; use `pnpm exec` for installed tools and `pnpm dlx` for one-off tools. Do not use raw npm or npx.
- Install with `pnpm install --frozen-lockfile`. Keep the pinned package manager, `pnpm-lock.yaml`, and `pnpm-workspace.yaml` security settings in sync. Review dependency scripts before granting narrowly scoped build permissions; never disable protections just to make installation succeed.

## Local development

- Run project commands directly from the repository. Do not introduce sandbox-specific cache paths, socket allowlists, temporary project copies, or escalation steps.
- Codex may start `pnpm run dev` in a persistent session, inspect the exact process listening on port 3000, stop a confirmed travel-plan process, and restart it after changes.
- Test the local app at `http://127.0.0.1:3000`. Keep the development server running while using the in-app Browser, and rely on Fast Refresh or reload the page after changes.
- Manage the isolated Rancher database with `pnpm run db:up:local`, `pnpm run db:migrate:local`, and `pnpm run db:down:local`.

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
   rtk pnpm dlx vercel --prod --yes
   ```

   Do not inspect or print environment values. If authentication has expired, ask the user to complete `pnpm dlx vercel login` once, then retry the deploy.

3. Smoke-check the production alias and expected admin hierarchy:

   ```sh
   rtk curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' https://travel-plan-green.vercel.app/
   rtk curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' https://travel-plan-green.vercel.app/admin
   rtk curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' https://travel-plan-green.vercel.app/admin/trips
   rtk curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' https://travel-plan-green.vercel.app/admin/users
   ```

   `/` should be `200`, `/admin` should be `404`, and the trips/users routes should be `200`.

Database migrations are separate from deployment. Run `pnpm run db:migrate` only for an intentional schema change; schedule data changes in Neon do not require a Vercel redeploy.
