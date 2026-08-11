# Trip schedule tracker

Next.js app backed by Neon Postgres.

## Local setup

1. Copy `.env.template` to `.env` and fill in the Neon and Google OAuth values.
2. Set `AUTH_OWNER_EMAIL` to the private email address for the owner account. Every other verified Google account is a contributor.
3. Run `npm run db:migrate` to create and seed the database.
4. Run `npm run dev`.

## Local admin mode

Coding agents can exercise the complete admin UI and CRUD flow locally without a Google session or access to Neon. The local adapter uses PostgreSQL in Docker while production keeps the Neon HTTP adapter.

```bash
npm run db:up:local
npm run db:migrate:local
npm run dev:admin
```

Open `http://127.0.0.1:3000/admin`. The header identifies this session as **Local admin · Docker Postgres**. The default database is `postgresql://travel:travel@127.0.0.1:55432/travel_local`; `LOCAL_POSTGRES_URI` may override it, but local admin rejects non-loopback hosts and never falls back to `POSTGRES_URI`. Its read cache is also namespaced away from normal data.

Stop the container without deleting its data with:

```bash
npm run db:down:local
```

The named Docker volume persists across restarts. To intentionally erase all local trip data, run `docker compose down --volumes`, start the database again, and rerun `npm run db:migrate:local`.

To preview or apply a trip import against the same local database:

```bash
npm run trip:import:local -- examples/trip-import.example.json
npm run trip:import:local -- examples/trip-import.example.json --apply
```

Local imports do not revalidate the production site. Regular `npm run dev`, `npm run db:migrate`, and `npm run trip:import` retain Google authentication and Neon through the normal `POSTGRES_URI`. `LOCAL_ADMIN_BYPASS` is intentionally set only by local npm scripts; do not add it to Vercel or a shared environment file.

The compatibility read API is available at `GET /api/itinerary`. Trip and schedule writes require the owner Google session. Contributors can only create comments/suggestions.

The Google OAuth callback URLs are:

- Local: `http://localhost:3000/api/auth/callback/google`
- Production: `https://<YOUR_DEPLOYMENT_DOMAIN>/api/auth/callback/google`

## CRUD API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` / `POST` | `/api/trips` | List or create trip plans |
| `GET` / `PATCH` / `DELETE` | `/api/trips/:slug` | Read, update or delete one trip plan |
| `GET` / `POST` | `/api/trips/:slug/schedule` | List or create schedule items |
| `GET` / `PATCH` / `DELETE` | `/api/trips/:slug/schedule/:activityId` | Read, update or delete one schedule item |
| `GET` / `POST` | `/api/trips/:slug/suggestions` | List suggestions or submit one while signed in |
| `PATCH` / `DELETE` | `/api/trips/:slug/suggestions/:suggestionId` | Owner moderation |
| `POST` | `/api/trips/:slug/sources` | Add a cited place source as the owner |
| `POST` | `/api/invitations` | Send owner-only invitation emails |

Create trip fields: `slug`, `title`, `date`, `timezone`, `location`.

Create schedule fields: `start`, `end`, optional `displayEnd`, `type`, `icon`, `title`, `detail`, and optional citation numbers in `refs`.

Invitation requests include `recipients`, `requestId`, `tripSlug`, `subject`, and `message`. The admin selects a trip, receives a subject and message draft generated from its current schedule, and may edit both fields before sending. The server validates the selected trip and the final draft. Addresses are normalized and deduplicated, with a maximum of 100 per request. Each address is sent as a separate Gmail message and cannot see the other recipients. The request UUID is included in the message headers for tracing.

Invitations are sent from the logged-in owner's Gmail account through Google OAuth; there is no separate sender address or mail-service API key. Enable the Gmail API in the same Google Cloud project, add the `https://www.googleapis.com/auth/gmail.send` scope to the OAuth consent screen, and sign out/in once to grant it. OAuth access and refresh tokens remain in the encrypted server session and are never returned to the browser. `APP_URL` becomes the invitation link.

## Deploy

Run `npm run vercel:env` to add the Neon and Auth.js values to Vercel, then run `npx vercel deploy --prod`.

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
