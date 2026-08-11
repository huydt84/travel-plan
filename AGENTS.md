<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Trip schedule updates

- When the user asks Codex to add or replace a trip schedule, convert their natural-language text, table, or image into the format in `examples/trip-import.example.json`.
- Keep a schedule item's optional `key` stable across later edits. If omitted, the importer derives it from the title.
- Run `npm run trip:import -- <file>` first and review the preview. Run the same command with `--apply` only when the user has asked to make the schedule change.
- The importer reads `.env`, validates all fields and citation references, and commits the whole import in one Neon transaction. Do not read or print secret values.
- Schedule data changes in Neon appear on the live site without a Vercel redeploy.

## Environment file safety

- Only files named exactly `.env` are protected environment and secret sources; similarly named files such as `.env.local`, `.env.prod`, `.env.template`, or `foo.env` are ordinary project files.
- Never read, print, modify, copy, or otherwise expose `.env`, even when filesystem access is unrestricted. Do not bypass this rule. Tell the user when a value must be changed.
- A user-requested project command may consume `.env` incidentally, but its values must never be intercepted or exposed.
- Access a remote database only through a repository script that reads its required environment variables internally. Never expand, interpolate, echo, or place a secret value directly in a shell command.
- If a command truly requires a literal secret value, ask the user to enter the value and run that command themselves. Never ask the user to paste the secret into chat.

## Local development

- Run project commands directly from the repository. Do not introduce sandbox-specific cache paths, socket allowlists, temporary project copies, or escalation steps.
- Codex may start `npm run dev` in a persistent session, inspect the exact process listening on port 3000, stop a confirmed travel-plan process, and restart it after changes.
- Test the local app at `http://127.0.0.1:3000`. Keep the development server running while using the in-app Browser, and rely on Fast Refresh or reload the page after changes.
- Manage the isolated Rancher database with `npm run db:up:local`, `npm run db:migrate:local`, and `npm run db:down:local`.

## Vercel deployment

Use this runbook for a production deploy from Codex desktop.

1. Run the normal checks in the repository:

   ```sh
   rtk npm test
   rtk npm run build
   ```

2. Deploy the linked project directly with the Vercel CLI:

   ```sh
   rtk npx vercel --prod --yes
   ```

   Do not inspect or print environment values. If authentication has expired, ask the user to complete `npx vercel login` once, then retry the deploy.

3. Smoke-check the production alias and expected admin hierarchy:

   ```sh
   rtk curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' https://travel-plan-green.vercel.app/
   rtk curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' https://travel-plan-green.vercel.app/admin
   rtk curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' https://travel-plan-green.vercel.app/admin/trips
   rtk curl -sS -o /dev/null -w '%{http_code} %{url_effective}\n' https://travel-plan-green.vercel.app/admin/users
   ```

   `/` should be `200`, `/admin` should be `404`, and the trips/users routes should be `200`.

Database migrations are separate from deployment. Run `npm run db:migrate` only for an intentional schema change; schedule data changes in Neon do not require a Vercel redeploy.
