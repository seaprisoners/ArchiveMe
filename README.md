# ArchiveMe

**Start learning:** the [complete beginner handbook](docs/BEGINNER_GUIDE.md) explains each component, Discord setup, security decisions, and operation step by step. To change the appearance yourself, follow the [easy website redesign guide](docs/REDESIGN_WEBSITE.md). **Portfolio deployment:** this repository is public source code; the running application is intentionally local-only until hosting, consent, and privacy review are complete. Do not upload its `.env` or `data/` directory.

**Private, opt-in Discord text-channel archiving and analytics** — an educational, read-only application. An official bot records messages from enabled server text channels. A separate website uses Discord login and checks **current Manage Server permission and channel-specific viewing permission on every request** before returning archive content or statistics. The public demo uses synthetic data only.

> Early-stage portfolio project; not audited and not a compliance certification. Do not deploy to a real community until you review the privacy and Discord policy checklist below. This project never uses a self-bot.

## What it does

- The front page introduces the official bot and, when it is configured and online, offers an **Add bot to your server** link. It requests only View Channel and Read Message History—not Administrator—and never enables archiving automatically. Because this site is currently localhost-only, people on other computers cannot use this website until you deliberately deploy it with HTTPS and review privacy/hosting obligations.
- Admins enable/disable individual server text channels with `/archive enable channel:#example`, `/archive disable channel:#example`, or the admin dashboard. Every channel defaults to **off**.
- Bot listens for new messages and edits through the official Gateway; it deletes recorded messages on deletion events when observed. Deleting/reenabling a channel is not a recovery mechanism. Bot removal deletes that server's local records.
- Website displays a read-only timeline and activity-per-day chart. Authentication is Discord OAuth2; **authorization is a fresh Discord membership/Manage Server and channel View/History check**, not just login or a role cached in the database. Admins may purge a channel's recorded messages through the API.
- Data expires after 90 days by default. Attachments, DMs, voice, threads, historical imports, and member-facing access are **not implemented**. The UI cannot promise a complete or legally durable archive: downtime, missing events, and API limitations produce gaps.

## How the pieces connect

```text
Discord Gateway -> discord.js bot -> SQLite database <- Express API <- React website <- browser
Discord OAuth2 ------------------------------------------^      (login only)
Discord REST API -> fresh server permission check ------------^ (each protected request)
```

GitHub holds **code**, not the running service or archive. A host must keep the Node.js process alive; SQLite should live on a persistent private disk. Backend and bot share one process and database for the beginner-friendly first deployment.

## Requirements

- Node.js **24.12+ or 26+** (uses built-in `node:sqlite`); npm. An always-on machine is needed for live ingestion.
- A Discord application and bot, configured in the [Discord Developer Portal](https://discord.com/developers/applications).
- For real deployment: HTTPS domain, persistent private disk, backups, restricted access, and current Discord-policy review.

## Local setup

1. `npm ci && npm --prefix web ci && npm --prefix web run build`
2. In the Developer Portal create an application. Create/copy its bot token, client ID, and OAuth2 client secret. Set redirect URI to **exactly** `http://localhost:3000/auth/callback` for local development. Enable the **Message Content privileged intent** if permitted and needed; this is a hard prerequisite for reliable content archiving. See [Gateway intents](https://docs.discord.com/developers/events/gateway) and [privileged-intent review](https://docs.discord.com/developers/gateway/getting-started-with-privileged-intent-review).
3. Invite the bot into **your own consenting test server**, requesting `bot` and `applications.commands` scopes and only View Channel and Read Message History permissions in selected channels. Do **not** give it Administrator. Ask a server manager to check what the bot can see. The setup command's user must have **Manage Server**. Configure OAuth2 credentials via environment variables; `.env.example` is a template, **not** a secret store and is not automatically loaded.
4. Example shell commands (replace values privately, never commit them):

   ```sh
   export DISCORD_BOT_TOKEN='...'
   export DISCORD_CLIENT_ID='...'
   export DISCORD_CLIENT_SECRET='...'
   export BASE_URL='http://localhost:3000'
   npm start
   ```

   Alternatively put values in an untracked `.env` and run `node --env-file=.env src/index.js` (never share that file). Open `http://localhost:3000` and log in. The site is restricted to server managers. For an unconnected portfolio preview, use the synthetic demo button on the login page; it must not sign in or read the database.
5. Enable **one test text channel**. Send consenting test messages. The bot starts recording *new* messages after enabling; no historical import occurs. Check the read-only website and analytics chart. Run `npm test` for automated checks. For backend development rebuild the UI with `npm --prefix web run build`; production serves that build from Express. Standalone Vite development does not proxy the backend by default.

## Core security model

- Browser receives neither database credentials nor bot token; OAuth2 code and PKCE verifier are exchanged on the server. OAuth state is single-use, short-lived, and bound to an HTTP-only cookie. Minimal `identify` scope only; Discord handles passwords/MFA.
- Backend sessions are opaque random cookies, stored hashed, HTTP-only, SameSite=Lax, and `__Host-`-prefixed with `Secure` on HTTPS, and expire after seven days. State-changing API requests require an anti-CSRF header token and reject mismatched Origins. Rate limiting, body limits, CSP, and security headers are enabled. Do not expose port 3000 directly to the internet without HTTPS termination.
- Every archive read, analytics request, admin change, and purge checks the user's **current** Manage Server permission and channel-specific View Channel/Read Message History permissions from Discord. Channel listings exclude channels they cannot view. The site does not currently grant normal members access, even to public channels; this prevents accidental leaks through search, graphs, and direct URL guesses. If Discord cannot confirm access, the request fails closed.
- Channels are off by default. Disabling a channel **hides** its existing data; to erase it, use the purge API: `DELETE /api/guilds/:guildId/channels/:channelId/messages` while logged in with a valid CSRF header. This action is permanent in the live database; retained backups require their own deletion policy. Edits/deletions are best effort if events arrive. Audit events log enable/disable/purge metadata, **not message bodies**.
- React renders message content as text. Never change the UI to inject untrusted HTML; constrain future export, search, analytics, and attachment endpoints by exactly the same authorization checks.

**Limits:** This is not an audited security product. A server administrator, hosting operator, database backup holder, or host compromise can expose data. SQLite files and backups require host filesystem security and encryption at rest where available. Role changes are evaluated through Discord on subsequent API requests; already downloaded content cannot be clawed back from a user's browser. The cache and backend behavior should be reviewed again if broader member access is ever built.

## Hosting

For the first deployment, run one Node.js process on an always-on VPS or application host with **persistent storage**. Put an HTTPS reverse proxy in front (for example, Caddy), configure its domain as `BASE_URL`, set `NODE_ENV=production`, keep port 3000 bound to `127.0.0.1` (default) behind a same-host reverse proxy and firewall. If your platform uses a separate proxy, explicitly set `HOST` to a private interface and protect the port. Set `TRUST_PROXY=loopback` **only** when the app is bound locally behind a trusted same-host reverse proxy (so per-client IP limits use that proxy's forwarded address). Never expose that proxy-enabled backend port directly. Set Discord redirect URI to `https://your-domain.example/auth/callback`. Run `npm ci`, `npm --prefix web ci`, `npm --prefix web run build`, then `npm start` as an unprivileged service user with provider-managed environment secrets. Restart on failure; monitor `/ready` (which reports 503 until Discord is connected), and monitor logs without recording message bodies. Back up the SQLite database using SQLite's backup API or an appropriate consistent snapshot (not a blind copy of the live main file when WAL is active). Encrypt backups, restrict access, and set an expiry period. Document what happens to backup data on purge/bot removal. Test restoration. **Current test status:** this computer has a connected Discord test bot and a localhost-only website; no publicly hosted website or production deployment has been provisioned by this repository.

A managed PostgreSQL service is a sensible later upgrade for separated bot and web deployments; SQLite keeps the first version understandable. Do not move the SQLite database onto an ephemeral app filesystem.

## Discord terms, privacy, and scope

Before any real community rollout, review the current [Discord Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy), [Developer Terms](https://support-dev.discord.com/hc/en-us/articles/8563935748247-Discord-Developer-Terms-of-Service), [OAuth2 reference](https://docs.discord.com/developers/topics/oauth2), [permissions](https://docs.discord.com/developers/topics/permissions), and applicable privacy law. These may change. Confirm message-content eligibility and any required app review. Never use a normal user's token/self-bot, evade API rate limits, or assume admin opt-in alone is sufficient privacy notice for members.

A real deployment needs a clearly visible, community-specific notice stating: what is recorded, which channels, who can view records, collection start date, retention period, hosting location, deletion requests, backups, and contact details. Do not archive sensitive channels by default. Stop collection and evaluate deletion when permission or consent changes. For GitHub screenshots and public demos, use **synthetic** content, never private server data. Seek legal advice where appropriate; this README is not legal advice.

## Future roadmap

- Permission-aware **member** views only after a well-tested Discord permission-overwrite/thread model and policy decision for pre-join history.
- Opt-in, rate-limited historical backfill with progress and completeness indicators.
- More analytics: selected date ranges, time zones, distinct participants (privacy reviewed), volume comparisons, and CSV exports guarded by authorization.
- Richer admin privacy controls, self-service retention/purge, robust backup deletion and data-request workflow.

## Development

`npm test` exercises opt-in ingestion, per-request denial, channel isolation, CSRF, input bounds, and deletion handling. CI builds the frontend and runs tests and dependency audit. Frontend is in `web/`; backend and bot live in `src/`. To make a portfolio screenshot, use the client-only synthetic preview, not a populated real archive.
