# Maintaining the app

Keep feature rules in shared modules and interaction state beside the UI that
owns it. Public routes, import JSON, and assistant operations retain their
existing contracts. All product features remain supported.

## Schedule changes

- `lib/trip-dates.mjs` owns interval validation and date-aware ordering.
- `lib/schedule-branching.mjs` owns branch overlap and anchor/rejoin validation.
  Imports validate their supplied order; interactive edits and AI proposals sort
  candidate activities before validation.
- `lib/schedule-keys.mjs` owns title normalization and collision handling.
  Importer occurrence numbering remains compatible. Editing titles must never
  regenerate persisted keys.
- `lib/schedule-queries.mjs` owns activity columns and citation replacement. It
  builds parameterized fragments using `sql-template-tag`, with no connection or
  commit of its own. Callers supply target relations containing their guards.
- `lib/schedule-store.mjs` commits an ordinary edit and its citations together.
  Omitted citations preserve links; an empty array clears them.
- `scripts/trip-import-store.mjs` owns whole-plan replacement and branch selection
  preservation. The command in `scripts/import-trip.mjs` owns preview and cache
  revalidation. Seeds reuse the transaction with create-only semantics.
- `lib/v1/committer.mjs` owns proposal claim, revision check, ordering and receipt.
  Its shared activity/source targets include the claim guard. Never call a
  separately committing repository mutation from an import or confirmation.

Repository validation still checks ownership, trip bounds, branch membership,
intervals and citation references before persistence.

## Client and invitation ownership

- `components/admin/EditorForms.jsx` owns trip, schedule, and source fields.
- `components/admin/useScheduleDraft.jsx` owns dirty-draft protection, editor
  focus, and discard confirmation, including remounted branch triggers.
- `components/tracker/Contributions.jsx` owns contribution loading, mutation,
  menus, composer, and deletion. The tracker supplies announcements and navigation.
- `lib/request-json.mjs` handles JSON transport, headers, cancellation, empty
  responses and errors. Feature callers provide fallback messages.
- `lib/invitation-handler.mjs` owns invitation permission, sender identity,
  recipient claims, delivery history and error responses. Its route binds real
  dependencies; unit tests exercise the same handler with isolated providers.
- `lib/google-auth-policy.mjs` owns basic login and incremental Gmail consent
  parameters and callbacks. Provider tokens remain in the encrypted JWT, outside
  the browser session.

## Styles

`src/styles.css` imports shared foundation, feedback, and cross-feature shell
rules. Feature styles use CSS Modules, with responsive rules beside their
owning feature. Shared buttons, footers, and modal behavior live in
`components/ui/`; dialogs use the app-owned Radix adapter.

See [UI styling and interaction ownership](ui-styling.md) for module boundaries,
compatibility classes, dismissal policies, and the visual regression workflow.
Do not rely on feature import order to resolve competing styles.

## Versioned database migrations

`node-pg-migrate` runs numbered files in `migrations/`, records them in
`public.pgmigrations`, and holds an advisory lock on a dedicated PostgreSQL TCP
session. The application still uses Neon HTTP in production. All pending
migrations and ledger writes run in one transaction; a failure rolls them back.

The initial five migrations adopt both legacy and current installations using
idempotent DDL and the historical data backfills. They do not insert seed trips
or overwrite trip metadata. `migrations/support.mjs` is frozen historical code;
it must not import evolving application validation or repositories.

- Use `pnpm run db:migrate:local` for the isolated Docker database.
- Use `pnpm run db:migrate` intentionally for the configured production database.
- Add a new `<timestamp>_<description>.mjs` file for future changes. Never edit an
  applied migration or manually remove its ledger entry.
- Export `async function up(pgm)` and use the migration builder or `pgm.db.query`
  with parameters. Keep changes transactional. Existing baselines intentionally
  have no destructive down migration; correct them with forward migrations.
- After a failure, correct the unapplied migration/configuration and retry.
  Production errors expose only a code because driver diagnostics may include
  private query values. Never log connection strings or raw driver errors.
- `AUTH_OWNER_EMAIL` is needed when legacy invitation/outbox rows lack an owner.
  Local mode supplies its local owner. A missing required owner aborts adoption.
- `pnpm run db:seed[:local]` is separate and optional. It inserts the seed trip in
  one transaction, or leaves an existing slug completely unchanged, including
  an intentionally empty schedule. Later schedule changes use the importer.

## Verification

Run `pnpm test` and `pnpm run build` from the repository, with Docker running and
local migrations applied. Unit tests check validation, authorization, transport,
Google consent and invitation workflow behavior. The Neon adapter test uses the
real installed client with a mocked HTTP transport to verify template and batch
compatibility without production access. Browser tests run against local
PostgreSQL and include:

| Risk | Coverage |
| --- | --- |
| Fresh install / upgrade / failed migration | `migrations.spec.mjs` checks real schema constraints, ledger, backfills, no-op reruns and transactional retry |
| Activity plus citations | `schedule-persistence.spec.mjs` forces FK failures and checks partial-edit semantics |
| Whole-plan import / seeds | `import-persistence.spec.mjs` checks keys, selected branches, notes, create-only conflicts and rollback |
| AI confirmation | `assistant-persistence.spec.mjs` checks rollback, stale revision guards, citation clearing and receipt replay |
| Assistant background execution | `assistant-companion.spec.mjs` checks Workflow delivery, per-trip state, event/cancellation fences and outbox retry; see [assistant operations](agentic-v1.md) |
| Permissions and visibility | Existing contribution/role/notification browser suites plus invitation handler tests |
| Drafts and focus | Branch editor and invitation browser tests |
| Layout and completed trips | `maintenance-ui.spec.mjs` checks geometry, timers, feedback and anonymous heartbeat |
| Shared CSS | `responsive-audit.spec.mjs` captures every public/admin surface at 320×760, 1440×900 and 1920×1080 |

Tests no longer inspect application source files to infer runtime behavior.
Inspect the complete screenshot batch, fix findings together, then run the
confirmation batch and relevant feature tests. Database integration tests create
and remove isolated schemas or uniquely named records; production is never used.

### Check the running local preview after test cleanup

The preview on port 3000 and the E2E server on 3100 share local PostgreSQL but
maintain separate Next caches. A passing suite on 3100 does not prove that the
already-running preview remains healthy after fixture deletion. Browser fixture
cleanup should use the trip DELETE API so its own server invalidates cached data.
The home page also recovers from a missing cached selection using fresh database
reads, because another process can delete a trip without invalidating its cache.

With the local admin preview running, verify that exact failure and the assistant
integration on the same server:

```sh
E2E_BASE_URL=http://127.0.0.1:3000 pnpm exec playwright test tests/e2e/trip-cache-recovery.spec.mjs
```

This regression warms the home page's list without loading the disposable trip's
itinerary, deletes that trip through another database client, revisits `/`, and
checks the tracker, inherited assistant trip and history at all three canonical
viewports. It reproduced an HTTP 500 before the recovery fix. The override accepts
only loopback hosts and does not start a second server.
