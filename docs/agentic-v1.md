# Integrated trip assistant

The feature-gated, admin-only assistant opens from **Trợ lý** beside the tracker’s trip controls or in admin navigation. It inherits the selected trip. At 1200px and above it accompanies the itinerary; smaller screens use a full-screen dialog. `/assistant` provides an expanded destination using the same conversation components. `/v1` redirects there, preserving `trip` and `conversation` parameters. Internal API and module names retain `v1` to avoid unrelated domain churn.

## Local development

Use pnpm 11.19.0 and the isolated local database:

```sh
pnpm install --frozen-lockfile
pnpm run db:up:local
pnpm run db:migrate:local
pnpm run db:seed:local
AGENTIC_V1_ENABLED=true APP_URL=http://127.0.0.1:3000 pnpm run dev:admin
```

Open `http://127.0.0.1:3000` and choose **Trợ lý**. Local admin mode defaults to a clearly labelled deterministic provider. Workflow runs locally through its Next.js integration; keep the development server running. The SDK owns generated `app/.well-known/workflow` routes and `.workflow-data`, both ignored by Git. Do not edit generated workflow routes.

`next.config.mjs` uses `withWorkflow`; `workflows/assistant.js` defines the workflow and execution step. This follows the [official Next.js integration](https://github.com/vercel/workflow/blob/main/docs/content/docs/v4/getting-started/next.mdx). If a proxy is added later, exclude the SDK’s `.well-known/workflow` paths from its matcher.

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `AssistantProvider.jsx` | Shared entry, responsive companion, recent background-completion badge |
| `useConversation.js` | Trip/conversation selection, drafts, history, recovery and obsolete-load cancellation |
| `transport.mjs` | Accepted JSON submissions and cursor-based event observation |
| `MessageContent.jsx` | Safe Markdown/GFM and grouped evidence controls |
| `Composer.jsx` | Growing input, Enter/Shift+Enter, IME and explicit Stop |
| `ConversationHistory.jsx` | Current-trip/all-trip history and pagination |
| `ProposalReview.jsx` | Sources, before/after values and explicit Apply |
| `background.mjs`, `background-store.mjs`, `dispatch.js` | Accepted jobs, durable dispatch, worker claims and event publication |
| `travel-assistant.mjs`, `gemini-adapter.mjs`, `batch-store.mjs` | Bounded model/tools, durable approval and atomic batches |

Assistant URL observation has its own Suspense boundary. It must never duplicate or suspend the existing tracker as a loading fallback.

## Acceptance, execution and recovery

Submission and observation are separate. `POST /api/v1/trips/:slug/assistant/turns` accepts `{clientTurnId, conversationId?, message, retryOfTurnId?}` and returns HTTP 202 with `runId`, `conversationId`, `status`, authoritative `turn` and `replayed`. It requires authenticated admin identity and same-origin browser context. The browser saves request identity and input before submission. An ambiguous response is recovered through actor-scoped request lookup; retries use the same identity and cannot create a second turn. A retry after a terminal failure uses a new identity.

`accept_assistant_background_request` atomically saves actor-scoped acceptance, the execution record and queued event. Submission attempts dispatch once, with a 15-second acknowledgement timeout. Failure atomically marks an unclaimed turn `DISPATCH_FAILED`; a worker that already claimed it continues. A late worker cannot claim a failed turn. There is no assistant cron or scheduled redispatch. The daily notification-email retry remains compatible with Vercel Hobby.

A confirmed manual retry sends a fresh `clientTurnId` and `retryOfTurnId`. The database validates ownership, trip, conversation, input, failed status and latest-exchange eligibility under the actor lock. A unique successor constraint prevents concurrent retries. Repeating the same identity recovers the same attempt. Each retry retains its original `exchangeId`; history paginates logical exchanges in original order and shows only the latest attempt. Older failed exchanges cannot be regenerated in place. Previous attempts remain in the database; only completed latest attempts enter model context.

A Workflow step invokes the existing Gemini/tool domain with a 270-second deadline and a 280-second execution lease. Acceptance gives queued work 60 seconds to be claimed. Workspace, event and history observation reconcile expired work into failure, including a server crash before dispatch. Closing chat, changing trips, navigation and lost connections only detach observation. They do not abort execution. An explicit **Dừng** persists cancellation; the worker observes that state and aborts provider work. The same turn-row lock fences cancellation, event append and final proposal publication.

A killed worker is not blindly restarted from an unknown provider position. Its expired lease becomes a failed/incomplete turn on reconciliation, and the user can explicitly retry. This preserves the current bounded-provider policy and avoids duplicated provider work. Successfully started Workflow execution survives viewer disconnects; they do not imply unlimited model execution or recovery of a provider’s hidden state.

## Event replay

`GET /api/v1/assistant/runs/:runId/events?after=N` is authenticated and owner-scoped. It returns NDJSON visible events with strictly increasing per-run sequence numbers. Observation lasts up to 20 seconds and reconnects from the last processed cursor. Duplicate events are ignored; gaps cause reconnection. Cancelling the response stream only releases the observer.

Events include accepted/queued, progress/running, actual `answer-delta`, normalized `evidence`, `awaiting_approval`, `awaiting_input`, and completed/failed/cancelled terminal states. Gemini streaming forwards only public model-output text steps. Every model interaction re-sends the system instructions, since `previous_interaction_id` carries history but not those instructions ([Google API behavior](https://ai.google.dev/gemini-api/docs/interactions-overview#server-side-state-management)). Tool payloads, thought steps and hidden reasoning never enter replay. A new model interaction can reset provisional answer text; the final persisted response remains authoritative. Production does not use typing timers or split a finished answer to imitate streaming.

`assistant_events` persists replay; partial text and evidence also update `assistant_turns`. `append_assistant_event` serializes writes and creates one terminal event per execution segment, including reconciliation of a stopped or interrupted worker. Late deltas after termination are rejected. Stored events omit confirmation tokens; the authenticated endpoint rehydrates the current proposal status and token when returning a terminal result. An incomplete response cannot publish an applicable proposal.

`POST /api/v1/assistant/runs/:runId` requests Stop. It checks ownership and same origin. If completion won the transaction race, it returns that completed turn; it cannot undo an already completed reply. `GET /api/v1/assistant/runs` returns up to 100 actor-owned runs from the last 24 hours for background status. The badge uses actor-scoped local storage to remember viewed completions, without changing the selected trip.

## History and browser state

`GET /api/v1/assistant/workspace` accepts:

- `trip`: trip slug; history defaults to this trip.
- `conversation`: actor-owned conversation UUID belonging to that trip.
- `request`: actor-scoped request UUID for recovering uncertain acceptance.
- `before`: opaque `nextCursor` for earlier turns in the same conversation.
- `historyBefore`: opaque `historyCursor` for another conversation page.
- `allTrips=1`: include the actor’s conversations across trips.

Conversation pages contain 30 entries; turn pages contain the latest 60 turns in chronological order. Pagination preserves PostgreSQL microseconds and stable UUID tie-breakers. The model receives the latest 12 completed turns with normalized evidence identifiers, including grouped citations.

Trip and conversation selections are URL-backed and support Back/Forward. Drafts and last selections are actor-scoped, per-trip session storage. Abort controllers and generation checks prevent late workspace responses from replacing a newer selection. Session storage must be available to send recoverable requests; drafts otherwise remain usable in the current view.

Messages render through `react-markdown` and `remark-gfm`, with raw HTML disabled and unsafe links removed. Grouped markers such as `[E5, E12]` open sources with keyboard focus and restore focus on close. Auto-scroll follows the reply only near the bottom; reading earlier content shows **Có câu trả lời mới**. Enter sends, Shift+Enter inserts a newline, and IME composition never submits.

## Blocking tools and provider safeguards

`ask_question` pauses a turn when the model needs a choice that materially changes the plan. One call contains one to three questions; each contains two to four single-select choices, exactly one marked recommended, and stable question/option IDs. The client appends its localized custom-answer option and caps free text at 1,000 characters. The normal composer is disabled until every question is answered and explicitly submitted, while Stop remains available.

The dedicated `assistant_questions` row is immutable apart from its lifecycle fields. `awaiting_input` has no expiry and releases the worker lease. A same-origin answer request validates the complete set, locks question and turn atomically, persists the first submission, adds a structured `ask_question` result to continuation context, increments the segment, and rearms dispatch without consuming user quota. Matching retries are idempotent; changed or competing submissions receive a conflict and reconcile authoritative state. Refresh, reconnect, history, device changes, owner review, recovery, and Stop all use the persisted question state. Submitted answers remain as a compact receipt while the same exchange continues.

Research tools execute automatically. The `apply_changes` tool pauses before execution and prepares an immutable batch of up to 24 create/update operations across explicit trip targets. Trips, activities, sources, and saved places share one approval. The inline chat request contains the full expandable review and Approve/Reject controls; it becomes a receipt in the same message. See [approval architecture](assistant-architecture.md#approval-per-write-call).

`awaiting_approval` releases the worker and suspends its deadline. Authenticated same-origin action endpoints check the action-bound token, current role/access, expiry and all target revisions. A single database transaction executes and consumes the whole approval, stores the receipt, and queues the next execution segment. Duplicate submissions return the receipt. Errors roll back all domain writes; changed or expired proposals require fresh approval. Each subsequent write call also requires fresh approval. Legacy pending proposals must be regenerated.

Continuation reconstructs context from persisted messages, calls and receipts, preserving captured model settings and attribution. Segment-fenced workers and replay checkpoints prevent stale workers or earlier waiting events from interrupting the next response. Closing, reloading and reconnecting preserve pending reviews and questions. Stop cancels the pending blocker. Owner oversight remains read-only and never receives approval credentials.

Existing limits remain: eight requested tools, at most two concurrent read-only calls, one retry for transient provider failures within the turn deadline, 30 turns per actor per hour, and 30-minute proposal expiry. Approval and question continuations share an eight-segment ceiling per original request. A generation may contain at most one blocking call and cannot combine `ask_question` with `apply_changes`. Search, Places and Routes retain normalized evidence and safe audit metadata; raw pages, full provider responses and hidden reasoning are excluded. Stored conversation text and replay events are private user content. Retention/export/deletion policy must be finalized before access expands beyond admins; no automatic retention purge is introduced here.

## Production rollout (separate from implementation)

The feature remains disabled by default. Configure server-side values through the project’s normal deployment settings:

- `AGENTIC_V1_ENABLED=true` enables assistant routes and admin entries.
- `GEMINI_API_KEY` and pinned `GEMINI_MODEL` enable Gemini/Search; the model default remains `gemini-3.6-flash`.
- `GOOGLE_MAPS_PLATFORM_API_KEY` is restricted to Places API (New) and Routes API.
- `AUTH_SECRET` signs proposal confirmations.
- `CRON_SECRET` authenticates the existing and assistant retry schedules.

Intentionally run production migrations before enabling the feature. The new migrations add background jobs, event replay and fenced event publication. Deployment does not migrate the database. Verify Workflow support and a plan/scheduler capable of the configured one-minute retry cadence before rollout. A local Workflow run is not a production deployment smoke test.

Package installation retains the repository’s provenance and build-script protections. Compatible attested transitive versions are pinned in `pnpm-workspace.yaml`; no global provenance exception or unrestricted install script permission is added. Reassess those overrides during dependency upgrades.

## Verification

```sh
pnpm test
pnpm run build
pnpm run test:assistant:live
```

The live-provider command is intentional and runs separately from E2E because both use the isolated local database. It consumes configured credentials internally, creates a disposable trip, checks Gemini text deltas plus Search/Places/Routes, validates a proposal, confirms once and replays the receipt, then removes that trip. It prints only safe diagnostics. Missing credentials leave live acceptance outstanding; never read or edit `.env` to troubleshoot.

Assistant regression suites cover actual local Workflow delivery, two-trip switching, close/reload, late loads, Back/Forward, drafts, history beyond 30 conversations/60 turns, cursor replay, cancellation fencing, duplicate claims, manual retry, scoped access, Markdown, citations/focus and IME. Existing suites cover stale proposals, atomic publication and confirmation races. The responsive audit covers all public/admin surfaces and assistant/history/companion states at 320×760, 1440×900 and 1920×1080; assistant coverage also includes 900px overflow and expired proposal states.

Controlled live-provider acceptance passed on 2026-09-05, including nonempty Gemini answer deltas before completion, Search/Places/Routes, staging without mutation, explicit confirmation and receipt replay. The first run exposed missing system instructions on tool continuations; that was corrected and covered by a deterministic regression before the successful rerun.

## Manual retry verification

`tests/e2e/assistant-retry.spec.mjs` covers dispatch/claim fencing, expiry, duplicate retries, actor and trip isolation, logical pagination, draft preservation, in-place replacement and reconnect without regeneration. `scripts/assistant-dispatch.test.mjs` verifies bounded dispatch and Hobby cron compatibility. UI evidence is captured in `.impeccable/review/manual-retry/` at the three canonical viewports. Connection loss is distinct from a failed execution: **Kết nối lại** observes the same run; **Thử lại** creates a new attempt only after confirmed failure.

Migration `1788825600000_assistant-manual-retry` is additive and required before deploying this version. Existing turns remain valid as one-attempt exchanges. The old execution-table dispatch columns are retained for migration compatibility but no longer schedule retries. Production migration and deployment are separate operations.

Verification on 2026-09-05: the repository check passed 145 unit tests and 106 browser tests (three retained-trip cases are opt-in). A separate run on `http://127.0.0.1:3000` passed all 18 companion, retained-trip and retry cases, including an additional unconfirmed-submission regression. Build and controlled Gemini/Search/Places/Routes acceptance passed. The responsive audit covered public/admin surfaces at 320×760, 1440×900 and 1920×1080, with 900px assistant coverage. The screenshot review found a clipped mobile reconnect action; the confirmation pass verifies it stays above the composer. Migration was applied locally only.


### One-generation live browser smoke

For a low-cost approval check, start a separate local server with `AGENTIC_V1_ENABLED=true`, `AGENTIC_V1_REAL_PROVIDERS=true`, `AGENTIC_V1_SINGLE_REQUEST_SMOKE=true`, and `LOCAL_ADMIN_BYPASS=true` on port 3102, with `APP_URL=http://127.0.0.1:3102`. Next reads provider credentials internally from `.env`; never inspect that file. Keep the normal simulated preview separate.

Run `pnpm exec node scripts/assistant-live-browser.mjs`. The local-only smoke budget permits one generation attempt, caps output at 1024 tokens, blocks generation retries and paid research tools, and leaves production behavior unchanged. The browser requests one new trip and one saved place, opens their inline review, verifies no domain writes, then rejects the batch. It never approves or triggers a continuation. The script removes its disposable local account/conversation and writes screenshots under `.impeccable/review/live-gemini`. Stop the live-provider server when finished.

Verified on 2026-09-06 with real `gemini-3.6-flash`: one generation, 5491 reported total tokens, two operations awaiting approval, inline rejection, zero domain writes. This check covers proposal generation and rejection; successful execution/continuation remains covered by the local database/browser suite, not by this deliberately limited live run.


### Owner error diagnostics

Chat keeps a short recovery message and Retry. Diagnostic details belong to **Quản lý trợ lý → Nhật ký lỗi** (`/admin/assistant`), not to a red error card in the conversation. The owner-only `/api/admin/assistant/failures` endpoint returns paginated failed attempts, including the owner's own requests and completed answers with failed research steps. Details are collapsed by default and include the turn/conversation IDs, timestamps, model, phase, error code, safe provider status, and tool audit durations. Admins and members receive 403; ordinary workspace/stream responses never include the new diagnostic column.

Migration `1789171200000_assistant-failure-diagnostics` stores `error_diagnostics` with the fenced turn failure transition. Dispatch acknowledgement races and late workers cannot overwrite a newer terminal result. `assistant.turn.failed` server log events share the turn ID with the admin panel. Diagnostics allowlist operational error type/code/status fields and bounded causes; raw provider messages, stacks, headers, bodies, and prompts are not copied. Historical failures retain their original codes and are explicitly labeled when richer diagnostics were never captured. Expired leases are marked `lease_expired`; a reached application deadline is `TURN_DEADLINE_EXCEEDED` with its configured duration.

The 45-second budget was too small for a multi-round research response: the reported production Hakone turn failed with `TURN_INTERRUPTED` 49.149 seconds after acceptance while a model call was active. Replaying the two-message sequence locally reproduced the interruption. The background budget is now 270 seconds, with a matching 280-second worker lease and the existing eight-tool/two-concurrent-tool caps. The pinned Workflow Next builder emits `steps.maxDuration: 'max'`; deployment must use Fluid compute, whose Hobby ceiling is [300 seconds](https://vercel.com/docs/functions/limitations). The 30-second margin accommodates step startup and finalization; exceeding this single-step budget requires durable step boundaries, not a timeout above the hosting ceiling. Acceptance remains a short request and queued dispatch retains its 60-second lease. General travel requests avoid scanning saved trips unless relevant; ambiguous edit targets require clarification.

Opt-in verification: start local development with `AGENTIC_V1_ENABLED=true AGENTIC_V1_REAL_PROVIDERS=true APP_URL=http://127.0.0.1:3000 pnpm run dev:admin`, then run `pnpm exec node scripts/assistant-scenarios.mjs --confirmation`. It uses an isolated local admin with the incident's `gemini-3.8-flash` model, rejects any proposed writes, and retains its local conversations for owner review. It never changes production schedules. Restore the ordinary local provider mode afterward. `scripts/assistant-inspect.mjs <conversation-uuid>` is a read-only incident lookup; `--turn` accepts a turn UUID instead. Only repository scripts consume credentials internally.

Verification on 2026-09-06: seven real-provider confirmation turns completed, covering the exact two-message sequence, a fresh Hakone request, an eight-tool detailed Hakone route, an ambiguous edit, an unverifiable museum, and Japanese translation. The detailed request took 56.588 seconds from acceptance to completion, demonstrating why a 45-second cap is insufficient. Before the changes, five of nine diagnostic attempts failed at the old deadline; one ambiguous edit prepared a proposal, which the harness rejected. The confirmation ambiguous edit asked which trip and prepared no changes. Results and browser captures are under `.impeccable/review/assistant-scenarios-confirmation/`. These are local real-provider observations, not a production deployment or a guarantee of future model output.
