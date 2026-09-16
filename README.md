# Trip schedule tracker

Next.js app backed by Neon Postgres.

## Package management

Use Node.js 22.13+ and pnpm 11.25.0 (pinned in `package.json`). Install pnpm using the [official installation instructions](https://pnpm.io/installation), then run `pnpm install --frozen-lockfile` before starting development. Commit `pnpm-lock.yaml` with dependency changes; do not generate an npm lockfile.

`pnpm-workspace.yaml` enforces a one-day release delay, blocks exotic transitive dependency sources and trust downgrades, and fails on unreviewed dependency install scripts. The current install hooks are explicitly disabled because published artifacts work without them. Review any new hook before changing `allowBuilds`; do not enable all builds or bypass the security settings to make an install pass. These controls reduce supply-chain risk but cannot guarantee safe packages. See [pnpm security guidance](https://pnpm.io/supply-chain-security).

The existing locked versions `next-auth@5.0.0-beta.32`, `eslint-import-resolver-typescript@3.10.1`, and `semver@6.3.1` have explicitly accepted, exact-version trust exceptions because their publications lack provenance present in earlier releases. Other versions remain subject to the trust policy.

Use `pnpm run <script>`, `pnpm exec <installed-tool>`, and `pnpm dlx <tool>` for one-off tools. Import arguments follow the script name directly, without npm's `--` separator.

## Local setup

1. Copy `.env.template` to `.env` and fill in the Neon and Google OAuth values.
2. Set `AUTH_OWNER_EMAIL` to the private email address for the owner account. Every other verified Google account starts with the `member` role; the owner can promote members to `admin` from the user management screen.
3. Run `pnpm run db:migrate` to upgrade the schema. Run `pnpm run db:seed` separately if you want the sample trip.
4. Run `pnpm run dev`.

## Local admin mode

Coding agents can exercise the complete admin UI and CRUD flow locally without a Google session or access to Neon. The local adapter uses PostgreSQL in Docker while production keeps the Neon HTTP adapter.

```bash
pnpm run db:up:local
pnpm run db:migrate:local
pnpm run db:seed:local
pnpm run dev:admin
```

Open `http://127.0.0.1:3000/dev/personas` to switch among Owner, Admin, Leader, Member, Outsider, and Anonymous. The fixed Leader and Member belong to the isolated `local-permission-lab` trip; Admin and Owner can override it only from admin surfaces. The persona cookie selects an identity only: global and trip roles are always read back from the local database. `db:seed:local` recreates this catalog and the two demo memberships idempotently without modifying other local trips.

The admin header identifies this session as **Local admin · Docker Postgres**. The default database is `postgresql://travel:travel@127.0.0.1:55432/travel_local`; `LOCAL_POSTGRES_URI` may override it, but local admin rejects non-loopback hosts and never falls back to `POSTGRES_URI`. Its read cache is also namespaced away from normal data. The persona page and cookie require both local admin mode and `LOCAL_PERSONA_SWITCHER=true`; `dev:admin` enables them, while the normal Playwright server and production do not.

Run the permission harness twice against the same local database with `pnpm run test:permissions:repeat`. Run the dedicated browser switcher and responsive checks with `pnpm run test:personas`; the normal `pnpm test` includes both the complete E2E suite and this local-only check.

Stop the container without deleting its data with:

```bash
pnpm run db:down:local
```

The named Docker volume persists across restarts. To intentionally erase all local trip data, run `docker compose down --volumes`, start the database again, and rerun `pnpm run db:migrate:local` followed by `pnpm run db:seed:local`.

To preview or apply a trip import against the same local database:

```bash
pnpm run trip:import:local examples/trip-import.example.json
pnpm run trip:import:local examples/trip-import.example.json --apply
```

Local imports do not revalidate the production site. Regular `pnpm run dev`, `pnpm run db:migrate`, and `pnpm run trip:import` retain Google authentication and Neon through the normal `POSTGRES_URI`. `LOCAL_ADMIN_BYPASS` is intentionally set only by local pnpm scripts; do not add it to Vercel or a shared environment file.

The compatibility read API is available at `GET /api/itinerary` after membership authorization. Any authenticated user can create a trip and becomes its Leader. Members can comment, suggest changes, and select schedule branches; Leaders manage their trip, schedule, and registered membership.

The Google OAuth callback URLs are:

- Local: `http://localhost:3000/api/auth/callback/google`
- Production: `https://<YOUR_DEPLOYMENT_DOMAIN>/api/auth/callback/google`

## Roles and permissions

The owner is the account whose email matches `AUTH_OWNER_EMAIL`. This role is fixed and includes every admin capability. Other authenticated accounts start as members. Only the owner can promote a member to admin or demote an admin to member.

Trip plans and schedules are private. Signed-out visitors receive no trip names or itinerary data, and a signed-in non-member receives `404` for direct slug access. Admin/Owner global access is exposed through `/admin/trips`; the main tracker still filters by membership.

| Capability | Owner | Admin | Member |
| --- | --- | --- | --- |
| Read trip plans and schedules | Membership on tracker; all in Admin | Membership on tracker; all in Admin | Membership only |
| Create trip plans | Yes; creator is Leader | Yes; creator is Leader | Yes; creator is Leader |
| Update or delete trip plans | Global override | Global override | Only as trip Leader |
| Create, update, or delete schedule items; add cited sources | Yes | Yes | Only as trip Leader |
| Create comments and suggestions | Yes | Yes | Yes, while signed in |
| View contributions | All, including hidden and rejected items | All, including hidden and rejected items | Visible trip items plus their own hidden or rejected items |
| Manage contributions | Change any status or visibility; delete any item | Change any status or visibility; delete any item | Hide, unhide, or delete their own items; set their own comments to `open` or `resolved` |
| Send invitation emails | Only to current trip Members | Only to current trip Members | Only as trip Leader and after permission approval |
| Review invitation permission requests and global delivery history | Yes | Yes | No; members can view their own permission state, quota, and delivery history |
| View the user and activity audit | Yes | Yes | No |
| Promote members or demote admins | Yes | No | No |
| Receive personal in-app notifications | Yes, when personally affected | Yes, when personally affected | Yes, when added, removed, promoted, or affected by trip activity |

## Trip assistant

The admin-only **Trợ lý** companion opens beside the selected itinerary and has an expanded `/assistant` view. It supports streamed replies, per-trip drafts, paginated history, sources and explicit proposal review. Enable it with `AGENTIC_V1_ENABLED=true` after local migrations. See [assistant development and operations](docs/agentic-v1.md) for Workflow dispatch, Stop/reconnect behavior, verification and the separate production rollout.

## Maintaining the codebase

See [the maintenance guide](docs/maintenance.md) for module ownership, versioned migrations, and verification. Migrations never seed or reset trip metadata. Seeds create a missing trip atomically and leave an existing trip untouched.

## CRUD API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/api/trips` | List the caller's memberships or create a Leader-owned trip |
| `GET` / `PATCH` / `DELETE` | `/api/trips/:slug` | Read as a Member; update/delete as Leader or Admin |
| `GET` / `POST` | `/api/trips/:slug/schedule` | Read as a Member; create as Leader or Admin |
| `GET` / `PATCH` / `DELETE` | `/api/trips/:slug/schedule/:activityId` | Read as a Member; update/delete as Leader or Admin |
| `GET` / `POST` | `/api/trips/:slug/members` | Read the roster or add one registered Member |
| `DELETE` | `/api/trips/:slug/members/:email` | Remove a Member; the Leader cannot be deleted |
| `PUT` | `/api/trips/:slug/members/:email/leader` | Atomically transfer leadership |
| `GET` | `/api/admin/trips/:slug/audit` | Read the immutable Admin/Owner activity log |
| `GET` / `POST` | `/api/trips/:slug/suggestions` | List contributions under the visibility policy or submit one while signed in |
| `PATCH` / `DELETE` | `/api/trips/:slug/suggestions/:suggestionId` | Manage a contribution under the role and ownership policy |
| `POST` | `/api/trips/:slug/sources` | Add a cited place source as Leader/Admin |
| `POST` | `/api/invitations` | Send invitation emails with implicit or approved permission |

Create trip fields: `slug`, `title`, `startDate`, `endDate`, `timezone`, `location`, and optional `memberEmails`.

Create schedule fields: `start`, `end`, optional `displayEnd`, `type`, `icon`, `title`, `detail`, and optional citation numbers in `refs`.

Invitation requests include `recipients`, `requestId`, `tripSlug`, `subject`, and `message`. A trip Leader or Admin selects a trip, receives a subject and message draft generated from its current schedule, and may edit both fields before sending. Every recipient must already be a registered Member of that trip; permission, quota, and history checks still apply. The server validates membership and the final draft before any Gmail side effect. Addresses are normalized and deduplicated, with a maximum of 6 per request. Each address is sent as a separate Gmail message and cannot see the other recipients. The request UUID is included in the message headers for tracing.

Invitations are sent from the approved sender's own Gmail account through Google OAuth; there is no separate sender address or mail-service API key. Enable the Gmail API in the same Google Cloud project, add the `https://www.googleapis.com/auth/gmail.send` scope to the OAuth consent screen, and sign out/in once to grant it. OAuth access and refresh tokens remain in the encrypted server session and are never returned to the browser. `APP_URL` becomes the invitation link.

## Notifications

Members, Leaders, and admins receive in-app notifications for relevant trip activity. Membership notifications cover being added, removed, or receiving leadership; contribution participation persists after contribution deletion. When a Leader or Admin changes a contribution's status or visibility, its author receives an in-app update.

New non-owner contributions also enqueue a private owner email through Resend. Create a sending-only Resend API key, register Resend with the same address as `AUTH_OWNER_EMAIL`, and configure `RESEND_API_KEY`. The free `onboarding@resend.dev` sender can then deliver to that owner address without a custom domain. Email delivery happens after the contribution response; failures never roll back the contribution.

Pending owner emails retry immediately and through the daily Vercel cron route. Configure a random `CRON_SECRET` of at least 16 bytes; Vercel supplies it as the cron route's bearer token. The worker stops after five failed attempts and never logs message bodies or secrets.

This feature adds database tables. The `deploy:prod` command applies pending migrations before deploying the code that depends on them.

## Deploy

Run one command after changing code or local environment configuration:

```bash
pnpm run deploy:prod
```

The Vercel CLI is a pinned development dependency invoked with `pnpm exec`; deployment does not resolve a new CLI through `dlx`. See [deployment toolchain decisions](docs/deployment-toolchain.md) for version and supply-chain review details.

This runs three steps in order: `vercel:env` syncs every non-`LOCAL_` variable declared in `.env.template` from the local `.env` into Vercel Production and Preview; `db:migrate` applies pending migrations to the database configured by `POSTGRES_URI`; then Vercel deploys to Production. A failed sync or migration stops the remaining steps. Already-applied migrations are skipped, and seed data is not imported. The template is the deployment allowlist; adding a deployable variable never requires editing the sync script. Environment sync only upserts declared variables and does not remove unrelated Vercel configuration.

## Import a trip with Codex

Codex can turn a rough Vietnamese itinerary, table, or image into the JSON format shown in `examples/trip-import.example.json`.

Preview and validate without changing Neon:

```bash
pnpm run trip:import examples/trip-import.example.json
```

Apply the reviewed import atomically:

```bash
pnpm run trip:import examples/trip-import.example.json --apply
```

An import upserts the trip, citations, and schedule by stable item key, then removes entries omitted from the imported schedule. New imports assign the configured Owner as Leader; updates preserve membership. Suggestions attached to a removed entry are preserved as trip-level notes, and imports are audited.
