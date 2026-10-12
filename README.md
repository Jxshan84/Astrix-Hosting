# Astrix Hosting

Astrix Hosting contains a Next.js dashboard and an Express API. The API persists accounts, servers, and support tickets in SQLite and manages server containers through Docker.

## Local development

Configure `backend/.env` from `backend/.env.example` before starting the API. Set `JWT_SECRET` to a unique random value of at least 32 characters. OAuth credentials and callback URLs are optional unless you want to enable their sign-in buttons.

Start the backend in one terminal:

```sh
cd backend
npm install
npm run dev
```

Start the frontend in another terminal:

```sh
cd frontend
npm install
BACKEND_URL=http://127.0.0.1:4000 NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:4000 npm run dev
```

The frontend listens on port 3000 and the API listens on port 4000 by default. Both bind to `0.0.0.0`; `PORT` can override the port. The frontend proxies API requests to `BACKEND_URL`. The live console connects directly to the public URL in `NEXT_PUBLIC_BACKEND_URL`; that host must expose the API's WebSocket endpoint as well as its HTTP API.

Server creation and lifecycle actions require the Docker CLI and a reachable Docker Engine on the backend host.

For Codespaces or another hosted environment, set `BACKEND_URL` to the backend's reachable URL and `NEXT_PUBLIC_BACKEND_URL` to the same backend's browser-reachable public URL. Do not use a localhost address for a separately hosted frontend. Forwarded ports are only available while the Codespace is running.

## Production configuration

Configure these variables in the environment where the backend runs:

- Required: `JWT_SECRET` (at least 32 characters); `FRONTEND_URL` in production.
- Owner authorization: `OWNER_USER_ID` (the numeric `users.id` of the owner account). Create/sign in to the intended owner account, read its `id` from the authenticated `/api/auth/me` response, configure this value on the backend, and restart the API. Owner authorization is based on this server-side identity; database roles and browser-supplied values do not grant owner access.
- Networking and persistence: `PORT`, `HOST`, `DATABASE_PATH`.
- Frontend/API origins: `CORS_ORIGINS`.
- OAuth (optional): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_CALLBACK_URL`.
- Premium plan synchronization (optional): `ASTRIX_BOT_SYNC_KEY`. Keep it on the backend only; it is not a Discord bot token.
- Discord integration (optional): `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_ANNOUNCEMENT_CHANNEL_ID`, `DISCORD_MOD_LOG_CHANNEL_ID`, and `BOT_POLL_INTERVAL_MS`. Configure the same `ASTRIX_BOT_SYNC_KEY` (at least 32 characters) only in the backend and bot environments. Never set it as a frontend variable.
- Public support details: `OWNER_NAME`, `OWNER_DISCORD`, `OWNER_EMAIL`, `SUPPORT_DISCORD`, `SUPPORT_WORK_START`, `SUPPORT_WORK_END`, `SUPPORT_TIMEZONE`.

Configure these variables in the frontend build/runtime environment:

- Required for production: `BACKEND_URL`.
- Required for the live console: `NEXT_PUBLIC_BACKEND_URL`.
- Optional port override: `PORT`.

Register OAuth callback URLs with the identity providers using the frontend origin and the corresponding `/api/auth/google/callback` or `/api/auth/discord/callback` path. Do not put client secrets, signing keys, or owner identifiers in frontend variables.

### Persistent backend deployment

The frontend can run on Vercel, but the API must run as a persistent Node.js process on a host with a reachable Docker Engine. This repository does not configure a hosting vendor, external panel, Docker cluster, or uptime SLA. Choose a provider that permits long-running Node.js services, persistent disk, Docker Engine access, and inbound HTTPS/WebSocket proxying.

1. Provision a dedicated Linux host and install a supported Node.js LTS release, npm, and Docker Engine. Keep the Docker daemon private; access to its socket is effectively host-root access. Do not expose the daemon over an unauthenticated network endpoint, and do not share this engine with untrusted workloads.
2. Deploy the repository's `backend/` directory. Set `DATABASE_PATH` to a writable file on persistent local disk, create the parent directory with permissions limited to the backend service account, and keep a single API process/host for this SQLite database. Do not place SQLite WAL files on a network filesystem or run multiple backend replicas against one SQLite file.
3. Before upgrading an existing installation, stop the API and make a SQLite-consistent backup. The API applies versioned migrations automatically at startup; review the migration source and keep the backup until the upgraded API has been checked. Never point a test environment at the production database.
4. Set `NODE_ENV=production`, `JWT_SECRET`, `OWNER_USER_ID`, `FRONTEND_URL`, `CORS_ORIGINS`, and `DATABASE_PATH`. Set the OAuth credentials/callbacks and bot variables only if those integrations are enabled. Use the public Vercel origin (scheme and host only) for both `FRONTEND_URL` and the corresponding CORS allowlist entry.
5. Build and start the API from `backend/` with `npm ci`, `npm run build`, and `npm start`. Keep the process under the host's service manager so it is restarted after a crash/reboot. Restrict inbound traffic to the HTTPS reverse proxy and required administrative access.
6. Configure the reverse proxy to preserve HTTP `Upgrade`/`Connection` headers for `/ws/console/` and forward normal API paths. Redact the short-lived console `token` query parameter from proxy/access logs. Configure its liveness check to `GET /health`; use `GET /health/ready` for readiness because it also requires SQLite and Docker Engine connectivity. Termination sends `SIGTERM`; allow time for active HTTP and WebSocket connections to close.
7. In Vercel, set `BACKEND_URL` to the public HTTPS API origin for the Next.js rewrites and `NEXT_PUBLIC_BACKEND_URL` to that same browser-reachable origin for the console WebSocket. Set `FRONTEND_URL`/`CORS_ORIGINS` on the backend to the production website origin. Rebuild/redeploy the frontend after changing its backend URL. Register OAuth callback URLs with the frontend origin, not the API origin.

The current Docker provider uses the Docker CLI on the API host, pulls the selected image during creation, applies per-container CPU/RAM limits, and stores user files in Docker named volumes. Atomic SQLite reservations cap the combined limits of application-managed containers at 80% of the Docker host's reported CPU and memory, leaving capacity for the OS and API; existing containers are accounted at their previous 512 MiB/0.5 CPU limits. Interrupted allocations remain reserved: the owner panel only offers release after Docker confirms that the provider resource is missing. Existing resources that are not represented by a server row require manual owner reconciliation and retain their reservation until then. This accounting assumes a dedicated Docker Engine and does not include containers or processes managed outside Astrix. Docker Engine does not expose a node/location catalogue through this implementation; allocation remains single-engine, with no cluster scheduling or provider-side capacity view. These containers start an idle shell loop; **Container running** does not mean a user application is installed or online. Starter templates are editable file suggestions only and are never executed automatically. Existing containers created before named volumes may not have their prior files migrated to `/home/container`; review and back up those containers before relying on the new file manager.

The API has broad control over its Docker Engine. Docker alone is not a strong hostile multi-tenant isolation boundary; for public workloads, deploy behind an appropriately hardened VM/sandbox runtime and apply host firewall, egress, storage, and resource policies. Do not claim availability beyond the guarantees of the selected backend host.

## Announcements, staff, restrictions, and appeals

The API applies versioned SQLite migrations at startup. Migration v4 adds per-server resource accounting and reservation fields; existing server records are preserved and initialized with the prior Docker limits of 512 MiB and 0.5 CPU. Any reservation left by the earlier schema is conservatively initialized to the maximum supported limits until the owner reconciles it, so an interrupted old allocation cannot silently free capacity. Stop the backend and create a SQLite-consistent backup before the first upgraded startup, for example:

```sh
sqlite3 "$DATABASE_PATH" ".backup 'astrix-hosting.before-owner-tools.db'"
```

The migration runner records applied versions in `schema_migrations`; it preserves existing users and announcement rows. Owner controls are available at `/owner` after `OWNER_USER_ID` is configured. Website announcements are delivered to the selected account inbox. Announcements sent to all accounts are also queued for the configured Discord announcement channel; server-owner-only announcements are deliberately not broadcast to a general Discord channel. Appeal intake/status events and sanitized security alerts are queued for Discord delivery.

Discord outbox deliveries use stable event IDs as Discord message nonces to suppress duplicate submissions within Discord's nonce window. Announcement delivery state appears in the owner panel; appeal/security notification failures are retained in the backend outbox and audit table for server-side diagnosis.

### Discord bot setup

The existing `bot/` package now runs one Discord.js v14 bot. Configure the backend's bot settings plus these bot process variables: `BACKEND_URL`, `ASTRIX_BOT_SYNC_KEY` (same private value as backend, at least 32 characters), `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_ANNOUNCEMENT_CHANNEL_ID`, and `DISCORD_MOD_LOG_CHANNEL_ID`. The bot only accesses the backend over authenticated server-to-server API calls. Use HTTPS for non-local backend URLs; plain HTTP is accepted only for a loopback endpoint outside production, and redirected API requests are rejected to avoid forwarding the bot key.

In the Discord Developer Portal, enable the **Server Members** and **Message Content** privileged gateway intents. Grant the bot only the guild permissions needed for the configured use: View Audit Log, View Channels, Send Messages, Embed Links, Read Message History, Moderate Members, and Use Application Commands. Place the bot's highest role above members it may time out. Do not grant Administrator. Ensure the announcement and moderation-log channels are restricted to the intended audience and reviewer group. Guild audit-log failures or insufficient role hierarchy fail safely and create a reviewable incident where possible.

The bot registers `/appeal`, `/appeal-status`, `/review-appeal`, `/warn`, and `/timeout` commands in `DISCORD_GUILD_ID`. Backend staff permissions are checked on every privileged command; Discord role names alone grant no access. Moderation automation only uses configurable spam thresholds, owner-configured phrase matching, warnings, and temporary timeouts; a single phrase match is only reviewable evidence, and the bot never bans. It logs message/channel/audit references and counts, not message content. Discord appeals require the Discord identity to be linked to an Astrix account; optional evidence is restricted to Discord-hosted PNG/JPEG/PDF attachments, up to 2 MB.

Run the bot in a third terminal after configuring both backend and bot environments:

```sh
cd bot
npm ci
npm test
npm start
```

Configurable protections cover repeated account login failures, repeated ticket/appeal/server actions, sustained CPU/memory overload (which can stop a container after the configured strike count), and Discord message patterns when the bot is configured. The owner emergency switch disables automated protections. Incidents are append-only and reviewable. Owners may explicitly revoke or restore staff permissions, including Discord moderation, from the owner panel; automation never silently revokes staff access or bans accounts. Discord timeouts are temporary and depend on Discord's current permissions/hierarchy. Website restriction appeals restore only website access. No Discord role or timeout is restored from a website appeal.

## Validation

```sh
cd backend && npm run build
cd frontend && npm run lint
cd frontend && npx tsc --noEmit
cd frontend && BACKEND_URL=http://127.0.0.1:4000 NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:4000 npm run build
```
