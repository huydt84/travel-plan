# Trip schedule tracker

Next.js app backed by Neon Postgres.

## Local setup

1. Copy `.env.template` to `.env` and fill in the Neon and Google OAuth values.
2. Set `AUTH_OWNER_EMAIL` to the private email address for the owner account. Every other verified Google account starts with the `member` role; the owner can promote members to `admin` from the user management screen.
3. Run `npm run db:migrate` to upgrade the schema. Run `npm run db:seed` separately if you want the sample trip.
4. Run `npm run dev`.

## Local admin mode

Coding agents can exercise the complete admin UI and CRUD flow locally without a Google session or access to Neon. The local adapter uses PostgreSQL in Docker while production keeps the Neon HTTP adapter.

```bash
npm run db:up:local
npm run db:migrate:local
npm run db:seed:local
npm run dev:admin
```

Open `http://127.0.0.1:3000/admin/trips`. The header identifies this session as **Local admin · Docker Postgres**. The default database is `postgresql://travel:travel@127.0.0.1:55432/travel_local`; `LOCAL_POSTGRES_URI` may override it, but local admin rejects non-loopback hosts and never falls back to `POSTGRES_URI`. Its read cache is also namespaced away from normal data.

Stop the container without deleting its data with:

```bash
npm run db:down:local
```

The named Docker volume persists across restarts. To intentionally erase all local trip data, run `docker compose down --volumes`, start the database again, and rerun `npm run db:migrate:local` followed by `npm run db:seed:local`.

To preview or apply a trip import against the same local database:

```bash
npm run trip:import:local -- examples/trip-import.example.json
npm run trip:import:local -- examples/trip-import.example.json --apply
```

Local imports do not revalidate the production site. Regular `npm run dev`, `npm run db:migrate`, and `npm run trip:import` retain Google authentication and Neon through the normal `POSTGRES_URI`. `LOCAL_ADMIN_BYPASS` is intentionally set only by local npm scripts; do not add it to Vercel or a shared environment file.

The compatibility read API is available at `GET /api/itinerary`. Trip and schedule writes require an authenticated owner or admin. Signed-in members can create comments and suggestions and manage their own contributions within the limits below.

The Google OAuth callback URLs are:

- Local: `http://localhost:3000/api/auth/callback/google`
- Production: `https://<YOUR_DEPLOYMENT_DOMAIN>/api/auth/callback/google`

## Roles and permissions

The owner is the account whose email matches `AUTH_OWNER_EMAIL`. This role is fixed and includes every admin capability. Other authenticated accounts start as members. Only the owner can promote a member to admin or demote an admin to member.

Trip plans and schedules are publicly readable, including by signed-out visitors. Authentication and role checks apply to writes and to non-public contribution data.

| Capability | Owner | Admin | Member |
| --- | --- | --- | --- |
| Read trip plans and schedules | Yes | Yes | Yes; also public to signed-out visitors |
| Create, update, or delete trip plans | Yes | Yes | No |
| Create, update, or delete schedule items; add cited sources | Yes | Yes | No |
| Create comments and suggestions | Yes | Yes | Yes, while signed in |
| View contributions | All, including hidden and rejected items | All, including hidden and rejected items | Public items plus their own hidden or rejected items |
| Manage contributions | Change any status or visibility; delete any item | Change any status or visibility; delete any item | Hide, unhide, or delete their own items; set their own comments to `open` or `resolved` |
| Send invitation emails | Yes; permission is implicit | Yes; permission is implicit | Only after an owner or admin approves their request |
| Review invitation permission requests and global delivery history | Yes | Yes | No; members can view their own permission state, quota, and delivery history |
| View the user and activity audit | Yes | Yes | No |
| Promote members or demote admins | Yes | No | No |
| Receive personal in-app notifications | No; the owner is intentionally excluded | Yes, for trips in which they participate | Yes, for trips in which they participate |

## Maintaining the codebase

See [the maintenance guide](docs/maintenance.md) for module ownership, versioned migrations, and verification. Migrations never seed or reset trip metadata. Seeds create a missing trip atomically and leave an existing trip untouched.

## CRUD API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/api/trips` | List trip plans publicly or create one as owner/admin |
| `GET` / `PATCH` / `DELETE` | `/api/trips/:slug` | Read publicly, or update/delete as owner/admin |
| `GET` / `POST` | `/api/trips/:slug/schedule` | List schedule items publicly or create one as owner/admin |
| `GET` / `PATCH` / `DELETE` | `/api/trips/:slug/schedule/:activityId` | Read publicly, or update/delete as owner/admin |
| `GET` / `POST` | `/api/trips/:slug/suggestions` | List contributions under the visibility policy or submit one while signed in |
| `PATCH` / `DELETE` | `/api/trips/:slug/suggestions/:suggestionId` | Manage a contribution under the role and ownership policy |
| `POST` | `/api/trips/:slug/sources` | Add a cited place source as owner/admin |
| `POST` | `/api/invitations` | Send invitation emails with implicit or approved permission |

Create trip fields: `slug`, `title`, `date`, `timezone`, `location`.

Create schedule fields: `start`, `end`, optional `displayEnd`, `type`, `icon`, `title`, `detail`, and optional citation numbers in `refs`.

Invitation requests include `recipients`, `requestId`, `tripSlug`, `subject`, and `message`. The signed-in sender selects a trip, receives a subject and message draft generated from its current schedule, and may edit both fields before sending. Owners and admins have implicit permission; members must first request permission and receive approval from an owner or admin. The server validates the selected trip and the final draft. Addresses are normalized and deduplicated, with a maximum of 100 per request. Each address is sent as a separate Gmail message and cannot see the other recipients. The request UUID is included in the message headers for tracing.

Invitations are sent from the approved sender's own Gmail account through Google OAuth; there is no separate sender address or mail-service API key. Enable the Gmail API in the same Google Cloud project, add the `https://www.googleapis.com/auth/gmail.send` scope to the OAuth consent screen, and sign out/in once to grant it. OAuth access and refresh tokens remain in the encrypted server session and are never returned to the browser. `APP_URL` becomes the invitation link.

## Notifications

Members and admins receive in-app notifications when another participant comments or suggests a change in a trip they have contributed to. Participation persists after contribution deletion. When an owner or admin changes a contribution's status or visibility, its non-owner author receives an in-app update. The owner intentionally has no notification bell.

New non-owner contributions also enqueue a private owner email through Resend. Create a sending-only Resend API key, register Resend with the same address as `AUTH_OWNER_EMAIL`, and configure `RESEND_API_KEY`. The free `onboarding@resend.dev` sender can then deliver to that owner address without a custom domain. Email delivery happens after the contribution response; failures never roll back the contribution.

Pending owner emails retry immediately and through the daily Vercel cron route. Configure a random `CRON_SECRET` of at least 16 bytes; Vercel supplies it as the cron route's bearer token. The worker stops after five failed attempts and never logs message bodies or secrets.

This feature adds database tables, so run `npm run db:migrate` intentionally before deploying code that depends on it.

## Deploy

Run `npm run vercel:env` to sync every non-`LOCAL_` variable declared in `.env.template` from the local `.env` into Vercel Production and Preview, then run `npx vercel deploy --prod`. The template is the deployment allowlist; adding a deployable variable never requires editing the sync script. The command only upserts declared variables and does not remove unrelated Vercel configuration.

## Import a trip with Codex

Codex can turn a rough Vietnamese itinerary, table, or image into the JSON format shown in `examples/trip-import.example.json`.

Preview and validate without changing Neon:

```bash
npm run trip:import -- examples/trip-import.example.json
```

Apply the reviewed import atomically:

```bash
npm run trip:import -- examples/trip-import.example.json --apply
```

An import upserts the trip, citations, and schedule by stable item key, then removes entries omitted from the imported schedule. Suggestions attached to a removed entry are preserved as trip-level notes.
