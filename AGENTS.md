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
