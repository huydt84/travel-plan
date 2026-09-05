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

Browser identity is never accepted. Each route obtains the actor through `getViewer()`, requires an admin role, and scopes conversations to the normalized actor email and one trip. `startTurn` returns increasing NDJSON events and persists the terminal result. All events include the run ID; an accepted event precedes progress and exactly one terminal event. A dropped stream is an uncertain outcome, not proof that the server failed. Tool progress is safe status text, not model reasoning or raw provider payloads.

Research tools are read-only. `stage_plan_changes` compiles typed operations against the private snapshot during the tool loop. Invalid operations return focused validation feedback for correction within the remaining budget. Source additions require a researched or canonical URL. At completion, one database statement publishes the answer and its immutable diff, digest, base revision, expiry, citations, and hashed confirmation token together. Interrupted or expired turns cannot publish; incomplete legacy proposals cannot be confirmed. Only the explicit confirmation endpoint can commit.

Confirmation requires a same-origin request and rechecks actor ownership, proposal token, status, expiry, and plan revision. The commit claims and applies the proposal in one Serializable transaction, records a receipt, and invalidates the existing itinerary cache after success. Repeated and concurrent confirmation return the stored receipt; serialization/deadlock failures retry at most twice. Revision conflicts apply nothing. The browser refreshes its trip snapshot and revision after confirmation.

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


## Request identity, recovery, and history

The additive `assistant-recovery` migration adds `assistant_requests` and the `accept_assistant_request` database function. Acceptance takes an actor-scoped transaction advisory lock and checks request identity, hourly quota, and conversation ownership before creating anything. A first submission atomically creates its conversation, turn, and ledger entry. This database function uses the same transaction semantics through Neon HTTP and local PostgreSQL; it avoids introducing a second connection/transaction abstraction for acceptance.

The ledger key is `(authenticated actor, clientTurnId)`. Repeating the same request resolves to its original turn, even if its first acceptance response was lost. The server rejects changed message/trip/conversation inputs. For a request initially submitted without a conversation, retries can use either the original null conversation or the conversation returned by acceptance. Older turns continue to support scoped replay through their original conversation.

Workspace reads and request acceptance reconcile expired running leases and unfinished tool records. Active runs have a 45-second execution deadline and a 55-second persistence lease, within the 60-second HTTP route limit. Disconnects abort providers; the browser recovers persisted state on return. A worker queue is not part of this pilot. A process crash is resolved when the lease expires and the next workspace read or submission reconciles it.

The browser saves pending request identity and input in actor-scoped session storage before sending. On reload or malformed/truncated streaming, it checks persisted status and polls every two seconds while the turn remains running. Navigation, terminal state, or a network failure stops polling. Unknown outcomes offer a same-ID resend; an explicit retry of a terminal failure uses a fresh ID. Session storage must be available to send recoverable requests.

`GET /api/v1/assistant/workspace` accepts:

- `trip`: existing trip slug.
- `conversation`: actor-owned conversation UUID.
- `request`: actor-scoped client request UUID; when found, selects that request's conversation and returns its full turn in `request.turn`.
- `before`: opaque `nextCursor` from an earlier response, used with the same conversation.

Responses retain the existing workspace fields and add `request` (`found` and `turn`) and `nextCursor`. Turns expose `leaseExpiresAt`. Pages contain the newest 60 turns in chronological order; timestamps in cursors preserve PostgreSQL microseconds. The model receives the latest 12 completed turns with evidence and proposal status. Existing evidence markers are normalized across history so older pilot turns that reused `E1` do not collide.

## Tool and provider limits

- Eight requested tools per turn, including invalid calls and proposal repairs; at most two independent read-only calls run concurrently.
- Proposal staging runs after the research calls in the same model response. Evidence is merged in request order, regardless of completion order.
- Transient network, 429, and server failures receive at most one retry per provider call, within the same deadline. Provider authentication/configuration failures are not retried automatically.
- Route waypoints are explicit `{address}` or `{placeId}` objects. Departure times without an offset use the trip timezone. Transit dates outside the provider's supported forecast window are reported as unavailable rather than substituted with today's route.
- Tool audit records contain safe request metadata, completion status, duration, validation diagnostics, and numeric provider usage when returned. They never store complete provider payloads or hidden reasoning. Failed provider-interaction cleanup emits a safe warning.
- Confirmation expiry remains 30 minutes; the open browser removes the apply control when that time elapses.

## Live-provider acceptance

Deterministic adapters remain the local default. Set `AGENTIC_V1_REAL_PROVIDERS=true` alongside local admin mode only when intentionally testing real providers against the isolated local database. Ordinary production mode always uses the real adapter; this flag does not enable local authentication outside development.

After local migrations, run:

```sh
pnpm run test:assistant:live
```

This explicit command consumes configured credentials internally and uses the fixed loopback test database. It creates a disposable trip, checks Gemini, grounded Google Search, Places search/details, and Routes, then verifies a grounded proposal, no itinerary writes before confirmation, one explicit application, and receipt replay. It deletes only its disposable trip in `finally`. It prints safe status/diagnostics, never credentials or raw provider errors. Run it separately from E2E suites because both use the local database.

Missing credentials return exit code 2 and leave live acceptance outstanding without provider calls or database writes. Provider or assertion failures return exit code 1. Do not edit or print `.env` to troubleshoot; the user configures missing values.

Verification on 2026-09-05 included a successful live smoke against the isolated local database. This demonstrates the configured provider path; it is not a guarantee of future provider latency or availability. Early smoke runs exposed invalid model operation arguments; focused validation feedback and an exact operation example were added, and the full grounded proposal/confirmation flow then passed.

The focused regression suites are `assistant-harness.test.mjs`, `assistant-recovery-db.spec.mjs`, `assistant-recovery.spec.mjs`, `assistant-v1.spec.mjs`, and `assistant-persistence.spec.mjs`. The responsive audit and expiry-state screenshots cover 320×760, 1440×900, and 1920×1080. Production migration/deployment and broader retention/export/deletion policy remain separate operational work before access expands.
