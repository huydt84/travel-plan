# Agentic travel assistant `/v1`

`/v1` is an additive, owner/admin-only pilot. It shares authentication and canonical trip data with the current application, but keeps its UI, HTTP adapters, conversations, prompts, provider adapters, and proposal write flow isolated under `app/v1`, `app/api/v1`, `components/v1`, and `lib/v1`.

## Enable locally

The pilot is off by default. Local admin mode uses the deterministic model adapter, so it does not call external providers:

```sh
pnpm run db:up:local
pnpm run db:migrate:local
pnpm run db:seed:local
AGENTIC_V1_ENABLED=true APP_URL=http://127.0.0.1:3000 pnpm run dev:admin
```

Open `http://127.0.0.1:3000/v1`.

## Production configuration

Configure server-side values without exposing them to the browser:

- `AGENTIC_V1_ENABLED=true` exposes the route. Leave it false to return 404.
- `GEMINI_API_KEY` enables the official Gemini adapter and separate Google Search grounding interaction.
- `GEMINI_MODEL` pins the model name; it defaults to `gemini-3.6-flash` and should not use a `latest` alias.
- `GOOGLE_MAPS_PLATFORM_API_KEY` is a separate, API-restricted key for Places API (New) and Routes API.
- `AUTH_SECRET` signs proposal confirmation tokens.

Run `pnpm run db:migrate` intentionally before enabling the production pilot. Deployment alone does not migrate the database.

## Module boundary

The server exposes three workflows:

```js
loadWorkspace(input)
startTurn(input)
confirmProposal(input)
```

Browser identity is never accepted. Each route obtains the actor through `getViewer()`, requires an admin role, and scopes conversations to the normalized actor email and one trip. `startTurn` returns increasing NDJSON events and persists the terminal result. Tool progress is safe status text, not model reasoning or raw provider payloads.

Research tools are read-only. `stage_plan_changes` compiles typed operations against a fresh private snapshot and stores an immutable diff, digest, base revision, expiry, citations, and hashed confirmation token. Only the explicit confirmation endpoint can commit.

Confirmation requires a same-origin request and rechecks actor ownership, proposal token, status, expiry, and plan revision. The commit claims and applies the proposal in one Serializable transaction, records a receipt, and invalidates the existing itinerary cache after success. Repeated confirmation returns the stored receipt; revision conflicts apply nothing.

## Provider and retention boundaries

Gemini interprets intent and orchestrates bounded tools. Search supplies current web research. Places supplies deterministic place identity, business state, hours, ratings, and available review context. Routes supplies duration, distance, and steps. Provider adapters normalize outputs before they enter the assistant.

Persist normalized evidence only: provider identifiers, source/Maps URLs, titles, attribution, timestamps, and derived claims. Do not store raw pages, complete provider responses, hidden reasoning, or unrestricted review payloads. Finalize pilot retention/export/deletion policy before access expands beyond owner/admin.

## Verification

Run:

```sh
pnpm run lint
pnpm run test:unit
pnpm run test:e2e
pnpm run build
```

The focused browser suite covers staged diffs, explicit confirmation, atomic receipt, reload resume, and same-origin rejection. The responsive audit includes `/v1` and every existing public/admin surface at 320×760, 1440×900, and 1920×1080.
