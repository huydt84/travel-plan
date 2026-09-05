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

`src/styles.css` is the single ordered entry point imported by the root layout.
Feature rules live in `src/styles/`: foundation, navigation, notifications,
tracker, contributions, invitations, admin shell, trip requests and schedule
editor. Invitation management includes permission/history/user audit tables.
`feedback.css` contains common error presentation and animations.

`responsive.css` is deliberately last: it owns the shared breakpoint overrides.
Preserving this cascade avoids route-dependent import order. Edit a feature's
base file and its responsive overrides together. Do not add global stylesheet
imports to individual components. The request queue uses content-sized grid rows
so long phone titles cannot overflow into another request.

## Versioned database migrations

`node-pg-migrate` runs numbered files in `migrations/`, records them in
`public.pgmigrations`, and holds an advisory lock on a dedicated PostgreSQL TCP
session. The application still uses Neon HTTP in production. All pending
migrations and ledger writes run in one transaction; a failure rolls them back.

The initial five migrations adopt both legacy and current installations using
idempotent DDL and the historical data backfills. They do not insert seed trips
or overwrite trip metadata. `migrations/support.mjs` is frozen historical code;
it must not import evolving application validation or repositories.

- Use `npm run db:migrate:local` for the isolated Docker database.
- Use `npm run db:migrate` intentionally for the configured production database.
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
- `npm run db:seed[:local]` is separate and optional. It inserts the seed trip in
  one transaction, or leaves an existing slug completely unchanged, including
  an intentionally empty schedule. Later schedule changes use the importer.

## Verification

Run `npm test` and `npm run build` from the repository, with Docker running and
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
| Permissions and visibility | Existing contribution/role/notification browser suites plus invitation handler tests |
| Drafts and focus | Branch editor and invitation browser tests |
| Layout and completed trips | `maintenance-ui.spec.mjs` checks geometry, timers, feedback and anonymous heartbeat |
| Shared CSS | `responsive-audit.spec.mjs` captures every public/admin surface at 320×760, 1440×900 and 1920×1080 |

Tests no longer inspect application source files to infer runtime behavior.
Inspect the complete screenshot batch, fix findings together, then run the
confirmation batch and relevant feature tests. Database integration tests create
and remove isolated schemas or uniquely named records; production is never used.
