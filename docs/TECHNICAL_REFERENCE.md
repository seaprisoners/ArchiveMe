# ArchiveMe: a beginner's handbook to the real application

> **Start here if you are new to bots, web applications, databases, or deployment.** This handbook describes the implementation in this repository, not an imagined product. Read it beside the [project overview](../README.md), [server entry point](../src/index.js), [database code](../src/db.js), [Discord integration](../src/discord.js), [authentication](../src/auth.js), [API](../src/app.js), and [React client](../web/src/main.jsx). Commands assume a POSIX-style shell (Linux/macOS) and that you run them from the repository root unless stated otherwise. Windows users can use an equivalent shell or adapt environment-variable syntax.
>
> **Safety boundary:** use a consenting test server and invented messages first. A Discord login is not consent from everybody whose messages might be stored. This is an educational, early-stage project, not a security audit, legal opinion, privacy certification, or representation that a particular deployment complies with Discord policy or law. Complete the privacy and deployment checklists before considering a real community.

## Contents and learning route

1. [What this project is—and isn't](#1-what-this-project-isand-isnt)
2. [Vocabulary from zero](#2-vocabulary-from-zero)
3. [Repository map, process, and diagrams](#3-repository-map-process-and-diagrams)
4. [Follow one message through the system](#4-follow-one-message-through-the-system)
5. [Create a Discord application, bot, and test-server invite](#5-create-a-discord-application-bot-and-test-server-invite)
6. [Install and run it locally with a consenting test server](#6-install-and-run-it-locally-with-a-consenting-test-server)
7. [Login: OAuth2, state, PKCE, sessions, cookies, and CSRF](#7-login-oauth2-state-pkce-sessions-cookies-and-csrf)
8. [Permissions: checking the person and the channel afresh](#8-permissions-checking-the-person-and-the-channel-afresh)
9. [SQLite tables, relationships, lifecycle, and retention](#9-sqlite-tables-relationships-lifecycle-and-retention)
10. [API and frontend, request by request](#10-api-and-frontend-request-by-request)
11. [Daily analytics, pagination, and accuracy limits](#11-daily-analytics-pagination-and-accuracy-limits)
12. [Testing, debugging, and failure modes](#12-testing-debugging-and-failure-modes)
13. [GitHub and a careful Git workflow](#13-github-and-a-careful-git-workflow)
14. [Deployment, TLS, persistence, and operations](#14-deployment-tls-persistence-and-operations)
15. [Backups, restoration, and deletion](#15-backups-restoration-and-deletion)
16. [Discord terms, privacy, and informed-consent review](#16-discord-terms-privacy-and-informed-consent-review)
17. [Deployment action checklist](#17-deployment-action-checklist)
18. [Further reading and link-review status](#18-further-reading-and-link-review-status)

## 1. What this project is—and isn't

ArchiveMe has **one official Discord bot**, **one Express web/API process**, **one local SQLite database**, and a **React browser interface**. The bot and web/API run together in a single Node.js process. A server manager explicitly enables individual **ordinary server text channels**; the bot listens to new messages there. The web interface lets a currently authorized server manager read stored text and see a per-day message-count chart. Another administrator can disable or purge a channel through the UI or API. Nothing in the site sends a message to a Discord channel, and “read-only archive” describes the message-reading experience, **not** the absence of administrative enable/disable/purge controls.

The defaults are intentionally conservative: every newly seen channel is disabled; only enabled channels accept new archive records; only users with current **Manage Server** permission and current **View Channel** and **Read Message History** access to the particular channel can use its archive endpoints. The site is **not a member-facing search engine**. Bot-originated messages and all DMs are excluded. Attachment/sticker **file storage and in-app binary downloads**, embeds as structured data, reactions, threads, voice, imported past history, exports, full-text server search, per-member dashboards, comprehensive deletion reconciliation, and a hosted service are **not implemented**. New messages can carry attachment/sticker metadata (for example name, type, size, optional external Discord-hosted URL) and recognized Unicode/custom emote usage metadata. The authorized browser may request supported sticker/custom-emote images directly from Discord's CDN for small thumbnails; this server never fetches or stores those files. Unsupported Lottie stickers have no thumbnail. Old archived messages cannot be retroactively supplied with missing metadata. The visible search field filters **only the messages already loaded into that browser view**. There is no real-data public demo or in-browser synthetic preview.

A message archive here is an **observed event log**, not an authoritative mirror of Discord. It may miss data during bot downtime or disconnects, lack of privileged message-content access, delivery/fetch failures, or missed edits/deletes. The code does not backfill. `deleted_at` exists in the schema, but observed Discord deletes actually remove rows; the UI's deleted-message placeholder is not a guarantee of tombstones. Default message retention is 90 days from the **original creation time**. Backups and users' previously downloaded browser copies need separate handling. The code is useful for learning but not sufficient evidence of compliance or completeness.

Why is there a bot at all? A website logged in as a person is not a substitute for a consented, properly permissioned bot. Discord's official bot/application model, scopes, intents, and permissions provide defined boundaries. **Do not use a normal user's token, automate a user account, create a “selfbot,” or ask a member for their Discord password.** Review Discord's current [bots documentation](https://docs.discord.com/developers/bots/overview) and [Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy) **(policy page requires review; automated retrieval returned 403)** before deploying. The bot has its own token; the browser user authenticates through Discord's OAuth2 redirect. Those identities do different jobs.

### Three safe exercises, in increasing difficulty

- **Exercise A: disconnected sign-in page.** Install/build and start with *no* Discord credentials. The sign-in page can render at `http://127.0.0.1:3000/`, but there is no accessible demo dashboard; `/ready` correctly returns `503` without the bot. Nothing from Discord is archived.
- **Exercise B: consenting test server.** Create your own test application, grant a bot only appropriate access, log in as a server manager, opt in a dedicated test channel, post invented text, inspect the archive, edit, delete, disable, and purge.
- **Exercise C: real deployment planning.** Complete permission, notice, policy, backup, security, and operational reviews first. A VPS and domain do not make a deployment safe by themselves.

## 2. Vocabulary from zero

| Term | Plain-language meaning in this project |
| --- | --- |
| **Discord application** | A configuration record in the Discord Developer Portal with an application/client ID; it can own a bot and OAuth2 configuration. It is not the same as the running Node program. |
| **Bot account / token** | A separate Discord identity controlled by a secret token. The server uses it for Gateway/REST bot operations. Treat the token like a password and never paste it into a browser or commit it. |
| **Guild** | Discord API word for a server. A guild ID identifies one server; it is not an authentication token. |
| **Channel** | A conversation location within a guild. This code admits `GuildText` channels only; a thread is not automatically equivalent. |
| **Snowflake** | Discord's decimal-looking ID string. Keep it as text, not a JavaScript number: number precision can be lost. API route IDs are checked against a 16–22 digit pattern. |
| **Gateway** | Discord's event connection used by the bot for new-message, edit, deletion, guild, channel, and interaction events. It is not a complete replay of all prior history. |
| **REST API** | HTTP requests made to Discord. Here, registration of the slash command and fresh member/channel lookups use Discord APIs. |
| **Intent** | A declaration of event categories a bot requests. `MessageContent` is privileged and requires a separate configuration/review decision. An intent is not a channel permission. |
| **Permission / overwrite** | Discord access granted by server roles and modified on particular channels; effective channel access can differ from a server-wide role. `ManageGuild` in code corresponds to Discord's “Manage Server” UI label. |
| **OAuth2 authorization code** | Temporary login result returned by Discord to this site's callback; the server exchanges it for an access token and looks up the user's identity. This flow is separate from inviting the bot. |
| **Scope** | A limited category of authorization. Browser login asks for `identify`; bot installation needs `bot` and `applications.commands`. Login does **not** request `guilds` scope. |
| **PKCE** | Proof Key for Code Exchange: a per-login verifier stays on the server while its SHA-256 challenge travels through the browser redirect. |
| **State** | Random, one-use OAuth value connecting a browser-started login with its callback, to reject unsolicited/mixed-up callbacks. |
| **Session cookie** | The opaque browser-held login reference after successful OAuth; the database stores only its hash. The cookie is not the Discord bot token or an OAuth access token. |
| **CSRF** | Cross-Site Request Forgery: another site attempts a state-changing request with your browser's cookies. Mutations here require a same-origin request and an extra header token. |
| **API endpoint** | An HTTP method plus path, e.g. `GET /api/me` or `PATCH /api/guilds/:guildId/channels/:channelId`; the colon names a variable segment. |
| **React component / state** | A function returning user-interface markup, and data in memory that makes the interface re-render. Browser state is not the SQLite database. |
| **SQLite / WAL** | Embedded database stored in files on one host; WAL (“write-ahead log”) is its journaling mode. An actively written WAL database must not be backed up by blindly copying only its main `.sqlite` file. |
| **Retention / purge** | Automatic removal after an age threshold versus an administrator-triggered channel archive deletion. Disable means **hide and stop new capture**, not erase. |
| **Reverse proxy / TLS** | A front server accepting HTTPS and forwarding to the private Node HTTP listener. TLS encrypts traffic in transit; it does not encrypt database files on disk. |
| **Eventual consistency** | An event or permission change may be observed only after Discord and the application communicate. The archive is updated when an event is handled, not atomically with Discord's internal state. |

If this is your first time using a terminal: `$` in tutorials means a shell prompt, not a character to type. `export NAME='value'` sets a variable for the current POSIX shell and its child processes; opening a new terminal loses it. `npm` installs/runs JavaScript packages; `node` runs the server. `git` records source-code history. HTTP status `200` means an ordinary success, `204` success with no body, `302` browser redirect, `400` bad request, `401` no valid login, `403` access denied, `404` not found, `429` too many requests, `502` OAuth/remote request failure, and `503` unavailable/not ready. A `403` should not be worked around by making the bot Administrator.

## 3. Repository map, process, and diagrams

The source code is intentionally small enough to read end to end:

```text
ArchiveMe/
├── README.md                  overview and safety boundaries
├── package.json               root scripts, required Node engine, backend dependencies
├── package-lock.json          exact dependency resolution for npm ci
├── .env.example               example names; NOT loaded automatically; no real secrets
├── .gitignore                 excludes .env, data, SQLite, node_modules, build output
├── src/
│   ├── index.js               startup/configuration, hourly cleanup, shutdown
│   ├── discord.js             bot events, slash command, fresh Discord permissions
│   ├── db.js                  SQLite tables, metadata migration, and query/helper functions
│   ├── auth.js                Discord OAuth2 login, cookie sessions, CSRF
│   └── app.js                 Express middleware, API routes, static frontend
├── web/
│   ├── package.json           React/Vite scripts and dependencies
│   ├── index.html             browser HTML shell and root element
│   └── src/
│       ├── main.jsx           React interface, fetch/state, statistics/media views
│       └── styles.css         presentation and responsive layout
├── test/
│   ├── security.test.js       access, channel isolation, CSRF, deletion, opt-in tests
│   └── oauth.test.js          login state/PKCE/session smoke tests with fake OAuth
└── .github/workflows/ci.yml   existing build, test, and audit workflow
```

Here is the **runtime architecture**; arrows indicate communication, not shared credentials:

```text
                           Discord's infrastructure
   ┌──────────────────────────────────────────────────────────────────┐
   │ Gateway events ────────────┐       OAuth2 authorization/token   │
   │ REST member/channel lookups│       and /users/@me               │
   └─────────────────────────────┼───────────────────────────┬────────┘
                                 │                           │
                       ┌─────────▼───────────────────────────▼────┐
                       │ ONE Node.js process (src/index.js)        │
                       │                                           │
                       │ discord.js bot     Express API + auth     │
                       │        │                  │               │
                       └────────┼──────────────────┼───────────────┘
                                └─────────┬────────┘
                                          ▼
                               private persistent SQLite
                        guilds/channels/messages/sessions/
                            oauth_states/audit_events
                                          ▲
 HTTPS browser ⇄ reverse proxy ⇄ Express API + static web/dist
       React UI                         (built by Vite)
```

Do not confuse the three locations: **GitHub stores source**; **the host runs bot and API**; **a private persistent disk holds the database**. The browser receives bundled React JavaScript, not the SQLite file or server environment secrets. The Developer Portal configures the Discord application; it does not host this process. Running Vite alone does not start the bot/API: there is no default development proxy from the standalone Vite server to these API routes. For a realistic local test, build the frontend and serve it from Express.

**Startup sequence in code:** [the entry point](../src/index.js) reads `BASE_URL`, `PORT`, `HOST`, `TRUST_PROXY`, and `RETENTION_DAYS`; checks numeric ranges and production prerequisites; opens a database at `DATABASE_PATH` (default `./data/archiveme.sqlite`); creates the Discord service and Express app; prunes expired messages immediately; schedules hourly message/session/OAuth-state cleanup; starts the HTTP listener; registers a global `/archive` command and logs the bot into Discord if credentials exist. A failed bot startup logs an error and closes the HTTP server. With no bot token or no client ID, nonproduction startup explicitly prints that the API is running without a live bot; the sign-in page can still render, but no synthetic preview is available. `/health` reports process health plus `botReady`; `/ready` is `503` until the bot is ready **and initial guild/channel synchronization completes successfully**.

**What the architecture does not have:** a queue, two independently deployed services, an admin background UI with its own database, managed backups, OAuth refresh tokens, a Discord-event replay log, or a guaranteed multi-instance deployment. A second process on another host with the same SQLite files would not be a supported production architecture. Synchronous `node:sqlite` operations also mean slow queries or slow disk can block this process; watch resource use and design changes before scaling.

## 4. Follow one message through the system

A concrete example makes all the pieces less abstract. Suppose you have a consenting test server `Test Lab`, an ordinary text channel `#archive-lab`, an opted-in message from a non-bot participant, and a server manager reading the website.

```text
1. Manager: enable #archive-lab via /archive enable or settings PATCH.
2. Discord: MESSAGE_CREATE reaches the logged-in bot's Gateway connection.
3. discord.js: messageCreate handler checks guild + author + not bot + GuildText.
4. db.js: archiveMessage checks channels.enabled=1, then INSERTs message.
5. Browser: GET /api/guilds/G/channels/C/messages?limit=50 with cookie.
6. Express: session exists; requireAdmin re-fetches manager membership;
   requireChannel confirms this saved channel and fresh channel access.
7. SQLite: listMessages reads only rows belonging to C and returns JSON.
8. React: MessageRow renders author, time, and content as text.
```

**First enablement:** bot `ready` synchronization fetches known guild channels and inserts channel metadata. The `channels.enabled` field defaults to `0`. `/archive enable channel:#archive-lab` is an interaction: before updating the DB, the bot checks the invoking user has current `ManageGuild`, the user can view/read channel history, and the bot can view/read channel history. The dashboard PATCH uses comparable checks before enabling. The user must also be allowed to install/manage the app in the test server according to Discord's current setup UI. The slash command is registered globally on startup; its visibility may take time and its presence does not override server/channel permissions. An ephemeral command reply tells only the invoker whether the update succeeded.

**New message:** `discord.js` listens for `messageCreate`. It rejects DMs (no `guildId`), messages from bots, and channels whose type is not `GuildText`. It collects message ID, guild and channel IDs, author ID, a display-name snapshot, avatar URL, text content, creation time, and possible edit time. `archiveMessage` first queries the enabled channel; if absent or disabled it returns false. If enabled it inserts a row with a unique message ID using `ON CONFLICT(id) DO NOTHING`: repeated create events must not overwrite an already edited record. The bot does **not** import preceding channel history. A message sent before enablement will not appear simply because somebody edits it later; edit logic updates only an existing saved row.

**Edit:** `messageUpdate` first checks that the message is already in SQLite, fetches a partial message from Discord if necessary, then replaces saved content and sets `edited_at` only while the channel remains enabled. An edit while disabled is not applied. Re-enabling later can expose old archived content that was hidden while disabled; it cannot guarantee old copies now match any Discord edits made while it was off. The code logs a fetch failure and moves on; it has no retry/reconciliation service.

**Delete:** `messageDelete` and `messageDeleteBulk` call `redactMessage`, which **deletes** corresponding SQLite rows; there is no recoverable message tombstone in the live database. Only events actually received can trigger this. A delete while the bot is offline may leave a stale archive row. Removing a channel deletes the channel row and its messages via foreign-key cascade if the `channelDelete` event is seen, and the next successful startup channel synchronization removes saved channels no longer found. A `guildDelete` event deletes that guild's local records; a **complete, successful** initial READY synchronization also reconciles guilds no longer in the bot's guild cache, but failures leave `/ready` unavailable rather than declaring the reconciliation complete. Backups need separate handling. **Never promise complete propagation, irreversible physical erasure, or instant processing.** A live SQLite deletion is not a deletion from a separate backup or somebody's screenshot. See [backup/deletion](#15-backups-restoration-and-deletion).

**Read:** the user visits the website, signs into Discord, and receives a local session cookie. For each protected request, Express checks the cookie against an unexpired hashed record and fetches the user's current Discord permissions through the bot. A readable message route additionally requires the selected saved channel to be currently readable and **enabled**. A different channel ID or guild ID cannot be swapped in for access: the DB lookup binds them and the Discord check evaluates that channel. `GET` returns at most 100 messages (50 by default); the UI loads 50 at a time. React inserts `message.content` as a JSX text expression, **not** untrusted HTML. An archived `<script>...</script>` remains text in the UI.

**Chronology caution:** messages are ordered by ID length then lexicographic ID, approximating newest-first snowflake order without converting large IDs to imprecise JavaScript numbers. A manager who fetched an earlier page can still hold its contents in the browser even if their Discord access is revoked after that response; the next protected request must be checked again. This is why revocation is prospective, not retroactive erasure.

## 5. Create a Discord application, bot, and test-server invite

This procedure describes concepts and the expected controls; Discord changes Portal labels and eligibility rules. Confirm the current [Developer Portal](https://discord.com/developers/applications), [Discord bot guide](https://docs.discord.com/developers/bots/overview), [OAuth2 guide](https://docs.discord.com/developers/topics/oauth2), [permission model](https://docs.discord.com/developers/topics/permissions), [Gateway intents](https://docs.discord.com/developers/events/gateway), and [privileged-intent review](https://docs.discord.com/developers/gateway/getting-started-with-privileged-intent-review). Creating a test app does not automatically grant a right to collect a community's history.

1. **Use an account and server you control for learning.** Create a dedicated text channel with only invented, consenting messages. Ask every participant in the test what is being stored and when it will be erased. If you cannot arrange consent, do not enable archiving; there is no synthetic preview.
2. **Create an application.** In the Developer Portal, create a new application named for your test. Copy its **Application ID** into `DISCORD_CLIENT_ID`. This ID is an identifier rather than the most sensitive secret, but do not mistake it for the bot token.
3. **Create/configure its bot.** In the Bot section, obtain its token into `DISCORD_BOT_TOKEN`. If a token is exposed, reset/revoke it and update the host. Avoid checking it into any repository, putting it in frontend build variables, writing it in docs/issues, or sending it to a collaborator over an insecure channel. Turn on the **Message Content** privileged intent if Discord permits it and if you need reliable message text; code requests `GatewayIntentBits.MessageContent` along with `Guilds` and `GuildMessages`. This is both a Portal configuration and a runtime intent requirement. Discord may require review/approval depending on application status. If you cannot lawfully/configurationally obtain the needed access, **do not work around it with a selfbot**. Without approved content access, event metadata/empty message bodies can make the archive misleading or connection fail depending on Discord behavior.
4. **Set the OAuth2 redirect.** In OAuth2 configuration add `http://localhost:3000/auth/callback` for local development. When deploying, add `https://your-domain.example/auth/callback`. The protocol, hostname, port, and path must match the `BASE_URL` constructed callback. If using `127.0.0.1` instead of `localhost`, either consistently change `BASE_URL` and registered callback or use `localhost` throughout. Do not append an unrelated path to `BASE_URL`; code appends `/auth/callback`. Obtain the **OAuth2 client secret** into `DISCORD_CLIENT_SECRET`, keep it server-side, and rotate it if leaked. This app's OAuth login requests only `identify` and does not need `guilds`, `email`, or `guilds.members.read` scopes.
5. **Invite/install the bot, separately from website login.** In the Portal's Installation/OAuth2 URL generator choose a guild/server-install context as presented by the current UI and request `bot` and `applications.commands` scopes. Grant only needed bot permissions, notably **View Channel** and **Read Message History** for the selected consenting channel; do **not** select Administrator or broad access just to fix a mistake. If your server's channel overwrites differ, adjust that particular channel's bot access and verify it can actually see the channel. The official [installation and OAuth2 documentation](https://docs.discord.com/developers/topics/oauth2) explains scope and permission URLs. These installation scopes are **not** the `identify` scope used for a user's website login. The bot reads incoming Gateway events; Read Message History is also checked by this application before enabling, even though historical import is not implemented. Never grant it more channels than intended.
6. **Choose a manager identity for login and enablement.** The person using the dashboard/slash command needs the server's effective **Manage Server** permission and effective **View Channel + Read Message History** for that target channel. This is distinct from the bot's access. Check role/channel overwrites in Discord; a manager can still lack access to a specific private channel. It is not necessary or appropriate to invite normal members into the admin dashboard.
7. **Observe registration behavior.** On boot `discord.start()` calls the REST global application-command registration (`Routes.applicationCommands(clientId)`) for `/archive enable channel:` and `/archive disable channel:` and then logs in. If the command is delayed, check registration logs, correct application ID/token, installation scopes, and Discord's current propagation behavior. A bot token for one application with a client ID from another is not a valid pair.

A generic install URL often includes a `client_id`, `scope=bot%20applications.commands`, and a `permissions` bitfield, but **prefer the Portal's current generated URL** so the install context, scopes, and permission bits match the app. The OAuth **redirect URI** is for login, not the invite landing page. An invite cannot by itself configure ArchiveMe's local process or provision its disk.

## 6. Install and run it locally with a consenting test server

### 6.1 Prerequisites and exact scripts

Install Node.js **24.12.0 or newer within major 24, or major 26+**, and npm. This matches the root `engines` expression `^24.12.0 || >=26.0.0` and uses built-in `node:sqlite`; Node 20/22 or an earlier Node 24 is not this repository's supported runtime. See [Node SQLite](https://nodejs.org/api/sqlite.html) and [Node CLI environment files](https://nodejs.org/api/cli.html#--env-filefile). Check:

```sh
node --version
npm --version
pwd                    # confirm you are in the ArchiveMe root
```

From the root, two packages must be installed separately because the web app has its **own** package file and lockfile:

```sh
npm ci                 # root: discord.js, Express, security middleware
npm --prefix web ci    # web: React, React DOM, Vite
npm --prefix web run build
npm test
```

`npm ci` installs from the lockfile reproducibly and fails if it disagrees with its package manifest. If you intentionally changed a dependency, update its lockfile using `npm install` in the corresponding package and review that change before committing. The root `npm run build` currently executes `npm --prefix web install && npm --prefix web run build`; that is convenient, but for a deployment with committed lockfiles the explicit `ci` sequence above is easier to audit. `npm run check` executes **tests, then root build** (which invokes `web install`); it does not itself run a security audit. `npm run dev` is Node watch mode for `src/index.js`, **not** a Vite proxy or automatic frontend bundler. `npm start` runs the combined server and bot without watch. `web` has separate `dev`, `build`, `preview` scripts; its dev/preview server on its own is **not** the complete ArchiveMe backend. Build after changing `web/src` and restart/reload Express as appropriate.

### 6.2 First run without credentials: check the sign-in page

This mode verifies that the page loads without touching Discord; it does not show an archive or portfolio demo. In a terminal from the root:

```sh
npm start
```

If no token/client ID are configured, expect a console line saying the Discord bot is not configured and the API is running without a live bot. Visit `http://127.0.0.1:3000/` (also reachable as `http://localhost:3000/` on many hosts): the sign-in page renders, but there is **no synthetic preview**, authenticated dashboard, or usable archive. `/health` can answer with `botReady:false` while `/ready` returns `503`; this is expected without a bot. Browser login via `/auth/discord` will return `503` without client credentials. If the page says “Frontend not built. Run npm run build,” build the web app first. If you have a local `.env` with real credentials, use `npm start` in a clean shell to avoid loading it accidentally, or follow the consenting test-server exercise instead.

### 6.3 Run with a real bot and local Discord login

Only after the test-server setup and privacy notice, export secret values in a shell (replace placeholders privately):

```sh
export DISCORD_BOT_TOKEN='paste-test-bot-token-here'
export DISCORD_CLIENT_ID='paste-application-id-here'
export DISCORD_CLIENT_SECRET='paste-oauth-client-secret-here'
export BASE_URL='http://localhost:3000'
export HOST='127.0.0.1'
export PORT='3000'
export DATABASE_PATH='./data/archiveme.sqlite'
export RETENTION_DAYS='90'
npm start
```

Prefer a password manager and a private host secret store over persistent shell history. The shell block is illustrative: **never replace placeholders with real values in a public document**. [`.env.example`](../.env.example) is a **tracked placeholder template** for creating an ignored local secret file, not a real credential file and not read automatically by Node/npm. Another local method is to create an ignored `.env` with owner-only file permissions, fill in the same variables, then run:

```sh
node --env-file=.env src/index.js
```

Do not commit or upload that `.env`; confirm `.gitignore` excludes it. Do not leave screenshots of its contents in issues. Node's `--env-file` flag appears **before** the script path; `npm start` alone does not load `.env`. The example is Unix-like; adapt file permissions to your OS.

Watch the terminal for “ArchiveMe listening ...” and “Bot connected as ...”. The service listens at `127.0.0.1:3000` by default; open **`http://localhost:3000/` consistently** because OAuth state/session cookies belong to the browser hostname. Click Continue with Discord. Authenticate on Discord's domain, accept the `identify` login scope, and return to your exact callback. Your manager must belong to an invited guild, have Manage Server, and be permitted to read the chosen channel; if not, the login may succeed but no usable workspace appears. If using a browser on **another machine**, its `localhost` refers to that machine, not the host: use an approved HTTPS deployment, not a casually exposed local port.

### 6.4 Perform a complete controlled exercise

1. Confirm a consenting `#archive-lab` test channel appears in Channel settings and is **off**. Send an invented message *before* enabling and verify it is **not** imported later.
2. Run `/archive enable channel:#archive-lab` as an authorized manager **or** toggle it on in the dashboard. The bot itself must see the channel and have View Channel + Read Message History. The website's toggle obtains a CSRF token before PATCHing; just changing browser text or URL cannot enable a channel.
3. As a non-bot test participant send a new message such as “test message one.” Open Message archive and refresh/reselect if needed; ArchiveMe has no live push to the browser. Inspect the chart for the selected channel and a 7-, 14-, or 30-day range.
4. Edit that message while the channel is enabled; fetch the archive again and see updated text and edit timestamp if its event was processed. Delete it in Discord, then re-fetch; expect removal if the event arrived. No guarantee exists for events missed during downtime.
5. Disable the channel. Its previously stored messages are hidden by read endpoints, but still stored. Re-enable it and note that old rows may reappear. Open the Purge dialog and confirm **only on test data**: the channel's archive rows are removed, but original Discord messages are unchanged. A backup made earlier can still contain them.
6. Give another test user no Manage Server permission, or deny the manager the channel's View Channel permission. Observe a denied API result; restore permissions for further tests. Sign out when done; stop the process with Ctrl-C. Reset test secrets if they were exposed during instruction or screenshots.

For simple non-sensitive diagnostics while the server runs:

```sh
curl -i http://localhost:3000/health
curl -i http://localhost:3000/ready
```

Do **not** publish a copied authenticated cookie, OAuth code, `X-CSRF-Token`, message JSON from a real community, or verbose request trace. Curl's unauthenticated `GET /api/me` returns `{ "authenticated": false }`, which is normal. Do not use guessed Discord IDs as substitutes for legitimate authorization.

## 7. Login: OAuth2, state, PKCE, sessions, cookies, and CSRF

Authentication answers **“which Discord account signed in?”** Authorization answers **“can this account read/manage this guild/channel right now?”** ArchiveMe separates those questions. OAuth login does not confer Manage Server or channel access. Read [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2), [Node crypto](https://nodejs.org/api/crypto.html), and [Express 5 API](https://expressjs.com/en/5x/api/) for underlying concepts.

```text
browser                 ArchiveMe server                  Discord OAuth2
   | GET /auth/discord        |                                 |
   |------------------------->| random state/verifier            |
   | 302 + short state cookie | save hash(state), verifier       |
   |<-------------------------| challenge = BASE64URL(SHA256(verifier))
   |---------------------- authorization URL + identify ------>|
   |<---------------------- callback?code=...&state=... -------|
   | GET /auth/callback      |                                  |
   |------------------------>| compare state with cookie;       |
   |                         | consume DB state once; check TTL |
   |                         | POST code + verifier + secret --->|
   |                         | GET /users/@me with token ------->|
   |                         | hash new session + CSRF secret   |
   |<---- session cookie + 302 /                              |
   | GET /api/me + cookie    | fresh Discord checks via bot     |
```

`GET /auth/discord` creates two cryptographically random 32-byte URL-safe strings. One is **state**: only its SHA-256 hash is stored in `oauth_states`; the raw value is sent both in the authorization URL and a short-lived, HTTP-only state cookie. The other is the PKCE **verifier**, stored in the DB; its SHA-256 Base64URL challenge appears in the authorization URL with `code_challenge_method=S256`. Both state record and cookie last five minutes. On callback, the code checks for a state, cookie, and code; compares hashed state and cookie with a timing-safe comparison; atomically consumes the saved row using `DELETE ... RETURNING`; then checks its expiry. A replay or missing cookie fails. The server exchanges the code with Discord's token endpoint using the verifier, client ID/secret, and exactly constructed redirect URI, then calls Discord `/users/@me` with the returned access token. It keeps the user's numeric ID, display name, and avatar hash, and creates its **own** session; it does not persist the OAuth access token in the schema or pass it to the frontend.

Successful login sets a random **seven-day** session cookie and saves only its SHA-256 token hash (`sessions.token_hash`). Login rotates any already-present session token for that browser if its shape is valid. On plain local HTTP, cookie names are `archiveme_session` and `archiveme_oauth`; on HTTPS, they are prefixed `__Host-`. Cookies have `HttpOnly`, `SameSite=Lax`, and `Path=/`; on HTTPS they also have `Secure`. HTTP-only means frontend JavaScript cannot read the session cookie directly, but the browser sends it to same-origin requests. Secure cookies need an HTTPS browser origin. Server-side expiration is evaluated per request; old DB rows are cleared hourly. Logout removes the server session and clears the cookie; it is a protected POST, not a Discord global logout. Two OAuth attempts in one browser can overwrite the one state cookie: restart login if you accidentally open competing authorization tabs.

**CSRF protection:** Even without JavaScript being able to read an HTTP-only cookie, a malicious page might induce browser requests carrying it. For **mutating** `/api` methods, this app rejects requests unless `Origin` exactly equals configured `BASE_URL` and an `X-CSRF-Token` header hashes to the current session's `csrf_hash`. `GET /api/csrf` creates and returns a fresh per-session token, rotating the prior one. The React UI calls it just before a PATCH or DELETE. `SameSite=Lax` adds a browser cookie restriction; it is not the sole CSRF defense. If two tabs fetch separate CSRF tokens, the earlier token becomes invalid—fetch again and retry safely. The backend enforces a 16 KiB JSON body limit, rejects `text/plain` for state-changing API requests, uses Helmet security headers/CSP, rate-limits `/auth` to 20 requests/minute and `/api` to 240/minute per its configured limiter, and sends no-store cache headers. Those are safeguards, **not** a guarantee against all attacks or properly tuned limits for every reverse proxy.

**Login success is not data access.** Sessions contain an identity; the Express API independently checks Discord at every guarded route. `GET /api/me` responds `authenticated:false` when no session, `503` when a session exists but Discord bot is unavailable, and otherwise lists only guilds for which `discord.isAdmin` currently succeeds. It does not use an OAuth `guilds` list as permission evidence. A role revoked after login should deny the subsequent protected request, though already returned content in a browser cannot be recalled.

## 8. Permissions: checking the person and the channel afresh

A bot token, OAuth identity, and session are three distinct credentials/identities. The server-side bot has to be in the guild to observe messages and check permissions. The web user does not receive the bot's privileges. Discord guild roles and channel overwrites can change; a stored “admin” flag would grow stale. For every protected request, `src/app.js`'s `requireAdmin` verifies the user has `ManageGuild` using a **forced Discord member fetch**, and `requireChannel` checks the saved channel belongs to that guild and `discord.canReadChannel` succeeds. `canReadChannel` again forces a member fetch and a fresh channel fetch with `force:true, cache:false` to avoid relying solely on cached overwrites, then checks effective `ViewChannel` **and** `ReadMessageHistory`. It refuses unknown, inaccessible, wrong-type, or unavailable channels. If Discord is down, this check catches failure and denies access rather than using an outdated DB role.

```text
Browser supplies guildId/channelId
     │
     ├── valid decimal Discord-style IDs? otherwise 404
     ├── session exists and unexpired? otherwise 401
     ├── bot sees guild + fresh member has Manage Server? otherwise 403
     ├── saved channel belongs to this guild? otherwise 404
     ├── fresh channel + member effective View/History? otherwise 403
     └── if reading messages/stats, channel enabled? otherwise 403
                   │
                   ▼
               bounded SQLite query
```

Channel listings query saved metadata, then **filter each channel** by live channel permission before returning its name, enabled status, and message count. A guessed direct URL goes through the same checks. Settings PATCH and DELETE purge use admin + channel permission and CSRF/origin checks too. On **enable**, a further check fetches the bot's member permissions for that channel; disabling/purging do not need the bot's access in that enable-specific check but still require the requesting human's access. The slash command performs its own human and bot checks before updating the same database. The bot may already have observed channel metadata without that channel being enabled; metadata/listings are not a grant of read access.

**Fresh does not mean magically atomic.** The member and channel fetches happen before the DB query; a permission could change immediately afterward. Discord itself can be temporarily unavailable, and an already downloaded page may remain visible to that browser user. An operator with filesystem or backup access can bypass the web checks. A server-wide Administrator may receive broad effective channel permissions under Discord's own model; this guide does not claim to override Discord's semantics. If you later add member access, threads, channel history before joining, exports, or cross-guild search, this entire authorization and privacy model must be reconsidered and tested rather than copied blindly. Read [Discord permission rules](https://docs.discord.com/developers/topics/permissions).

### Limits worth writing on the whiteboard

- `PORT`: integer **1–65535**; `RETENTION_DAYS`: integer **1–3650**; production `BASE_URL` must use HTTPS, and production requires bot token/client ID/client secret.
- IDs in API routes: **16–22 decimal digits**; invalid IDs get `404`. This is syntax validation, not proof an ID belongs to you.
- Messages list: default **50**, minimum **1**, maximum **100**; optional valid `before` snowflake. The UI fetches 50 initially and 50 per “load more.”
- Stats: default **30 days**, valid **1–90** days; UI selects 7, 14, or 30. Message retention default **90 days**, customizable independently up to 3650. A 90-day stats window can contain fewer days if retention is shorter.
- Login state: **5 minutes**, session: **7 days**; hourly cleanup plus immediate TTL checks. Rate-limit windows: **60 seconds**, `/auth` 20 and `/api` 240; oversized JSON rejected at **16 KiB**.
- Restrictions are in server code, not just input widgets. These bounds are protective but may still need tighter resource planning; user-supplied IDs and content are not inherently trustworthy.

## 9. SQLite tables, relationships, lifecycle, and retention

`src/db.js` creates the initial tables with `CREATE TABLE IF NOT EXISTS` and conditionally adds `messages.category` and `channels.purged_before_id` for existing databases. These guarded column additions preserve old message rows, but they are **not** a general-purpose versioned migration framework. It also creates `message_media` (per-message attachment/sticker metadata), `message_emojis` (recognized per-message Unicode/custom emote counts), `redacted_messages` (temporary deletion replay guards), and `archive_policy` (retention cutoff). `openDatabase` makes the containing directory if necessary, then opens `node:sqlite`'s synchronous `DatabaseSync` and configures `PRAGMA foreign_keys=ON`, `journal_mode=WAL`, and `busy_timeout=5000`. Prepared statements bind placeholders rather than interpolating user input into SQL. SQLite is a file-based transactional store, not a cloud service; it still needs a secure persistent disk and backups. See [Node SQLite API](https://nodejs.org/api/sqlite.html), [SQLite foreign keys](https://www.sqlite.org/foreignkeys.html), and [SQLite WAL](https://www.sqlite.org/wal.html).

```text
 guilds(id PK, name, icon)
     │1
     ├────────< channels(id PK, guild_id FK, name, enabled, updated_at)
     │                     │1
     │                     └────────< messages(id PK, guild_id FK,
     │                                  channel_id FK, author_id, author_name,
     │                                  avatar_url, content, created_at,
     │                                  edited_at, deleted_at)
     └───────────────────────────────< messages.guild_id

 sessions(token_hash PK, user_id, username, avatar, csrf_hash, expires_at)
 oauth_states(state_hash PK, verifier, expires_at)
 audit_events(id PK, guild_id, actor_id, action, target_id, at)
```

**`guilds`:** `id TEXT PRIMARY KEY` is the Discord guild ID; `name TEXT NOT NULL` and nullable `icon` are synchronized metadata, not access grants. `syncGuild` inserts or updates name/icon. Deleting a guild row cascades to `channels` and `messages` because of foreign keys.

**`channels`:** `id TEXT PRIMARY KEY`, `guild_id TEXT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE`, `name TEXT NOT NULL`, `enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1))`, `updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP`, and nullable `purged_before_id` recording a high-water mark after purge. The bool-like integer is `0` or `1`; JavaScript converts it to a boolean in the API listing. `syncChannel` updates the name of an already known channel but does **not** silently turn it on. `channels_guild` speeds lookup by guild. Removing a channel row cascades to that channel's messages. `setChannelEnabled` changes state/time and records an audit event when it updates a matching row.

**`messages`:** `id TEXT PRIMARY KEY` is the unique message snowflake. `guild_id` and `channel_id` both have `ON DELETE CASCADE` foreign keys. `author_id`, `author_name`, `content`, and `created_at` are required text. `avatar_url`, `edited_at`, `deleted_at`, and the exclusive content `category` are nullable. A NULL category on a pre-migration message means unknown; it is not retroactively classified as text-only. `author_name` is a snapshot, not a live profile lookup; avatar URL can be personally identifying or become stale. This code writes `deleted_at=NULL` on insertion and **deletes** rows on observed deletion; the column and a frontend placeholder should not be taken as user-facing tombstones. A separate `redacted_messages` table now guards against delayed re-ingestion of observed deletions. `messages_channel_id`, `messages_numeric_order`, and `messages_channel_time` indexes support listing/order/time aggregation. The channel query returns author ID/name/avatar, content, created/edited/deleted times, never private session fields.

**`message_media`, `message_emojis`, `redacted_messages`, `archive_policy`:** New opt-in messages can have child rows for attachment/sticker name, content type, size, and a validated Discord CDN URL, plus parsed emote names and occurrence counts; the app never stores file bytes. Deleting or pruning a parent message cascades to those rows. Deletion tombstones and a per-channel purge marker prevent delayed Discord events from re-archiving erased messages. The stored retention cutoff prevents re-ingestion of messages already aged out; tombstones older than this cutoff are removed. The optional external URL may expire.

**`sessions`:** `token_hash TEXT PRIMARY KEY`, user ID, username, nullable avatar, `csrf_hash`, and numeric millisecond `expires_at`. These are login sessions, not a table of privileged Discord roles. Hashes reduce exposure of raw cookies if this one table is leaked, but a compromised server/database can still expose sensitive data and impersonation risks elsewhere. The index `sessions_expiry` supports cleanup. `/api/csrf` updates the current session's CSRF hash.

**`oauth_states`:** hashed short-lived state (`state_hash TEXT PRIMARY KEY`), associated PKCE `verifier`, millisecond expiry. Login consumes the row once. Unlike token and state, the verifier is stored as text until used/expired; restrict DB access. No OAuth access/refresh-token table exists.

**`audit_events`:** auto-increment numeric ID, optional guild ID, required actor ID/action, optional target ID, default timestamp. Enabling, disabling, and purge insert metadata events, **not message bodies**. This table is not tied by foreign keys to guilds or channels and no automatic audit-event retention policy is coded; when a guild or channel is deleted, old audit metadata may remain. Plan privacy and retention of **all tables**, not just message bodies.

**Retention:** `pruneMessages(db, days)` deletes rows where `created_at` is earlier than the current time minus `days * 86400000`, at startup and hourly. Date/time is saved as ISO strings for messages; the threshold uses `toISOString()` so lexical comparisons work with correctly formatted timestamps. This is a rolling age calculation, not a calendar-midnight sweep or guaranteed deletion at the exact second of expiry. If the process is down, pruning resumes at startup; your backup copies will not be altered automatically. Hourly cleanup also deletes expired `sessions` and `oauth_states` DB rows. There is no scheduled cleanup of audit events, guild/channel metadata, or backups. Changing `RETENTION_DAYS` does not resurrect deleted data; choosing a shorter value deletes matching records on next cleanup.

**Disable vs purge:** Disable flips `enabled` off and denies message/stats reads; it leaves messages and their counts in SQLite until age-based prune or explicit purge. Re-enable may expose surviving older rows, including potentially stale edits. Purge deletes channel message rows (which cascade to media metadata), stores a message-ID high-water mark to reject delayed pre-purge creates, and records metadata audit; it does **not** disable collection, so new later messages can again be archived while the channel stays enabled. If you intend to stop collection **and** erase existing rows, disable then purge, and account for backups. Delete events remove individual rows. If the bot is removed, `guildDelete` deletes the guild's local rows when observed; after an offline removal, successful initial READY reconciliation removes guilds absent from the bot cache. A failed synchronization delays readiness and cleanup, so validate operationally rather than promising instant removal.

**Schema-change caution:** do not hand-edit production SQLite or casually add columns and assume `CREATE TABLE IF NOT EXISTS` updates existing tables. The two guarded column additions above provide a specific migration for legacy archives, not a generic migration mechanism. Future changes need an explicit migration and backup/rollback plan. SQLite's synchronous API runs in the same Node process; watch disk space, query performance, connection failure, and operator access.

## 10. API and frontend, request by request

Express 5 in `src/app.js` attaches middleware in order: disables `X-Powered-By`; adds Helmet/CSP; parses JSON up to 16 KiB; rejects some inappropriate mutation content types; applies auth and API rate limits; marks responses no-store; installs auth routes/session+CSRF middleware; exposes health and API endpoints; then serves `web/dist` if built, falling back to an SPA index for other GET routes. For an unbuilt UI, `/` returns 503 with a build instruction. Middleware **order matters**: auth setup runs before protected API handlers. The Express error handler logs server-side and sends a generic 500 response. See [Express 5 middleware](https://expressjs.com/en/guide/using-middleware.html) and [Express 5 API](https://expressjs.com/en/5x/api/).

| Method and path | Purpose | Access and notable behavior |
| --- | --- | --- |
| `GET /health` | Process-health JSON with bot readiness | Public; `ok:true` does **not** imply live ingestion. |
| `GET /ready` | Bot readiness | Public; returns `503` until Discord client reports ready **and** initial server/channel synchronization succeeds; `200` after that. |
| `GET /auth/discord` | Begin Discord login | Redirect; needs OAuth client ID + secret; 20/min auth rate limiter. |
| `GET /auth/callback` | Complete OAuth code exchange | State cookie, state DB row, PKCE verifier, Discord identity call; creates session. |
| `GET /api/me` | Current login and authorized guild list | No session → `authenticated:false`; with session but no bot → `503`; guild list uses fresh admin check. |
| `GET /api/csrf` | Rotate/read CSRF secret for a mutation | Requires session; token not a permission grant. |
| `POST /api/logout` | Invalidate local session | Requires session, matching Origin and current CSRF token; response `204`. The current frontend first fetches `/api/csrf`, sends its `X-CSRF-Token`, then clears local session state on success. Manually clearing the site's cookie is not equivalent to invalidating an unexpired server session. |
| `GET /api/guilds/:guildId/channels` | Guild and permitted channel metadata/counts | Admin check; filters each candidate by live channel access. |
| `GET /api/guilds/:guildId/channels/:channelId/messages` | Recent archived messages | Admin+channel+enabled; bounded `limit`/`before`; `nextBefore` cursor. |
| `GET /api/guilds/:guildId/channels/:channelId/stats` | Daily/hourly counts and category summaries | Admin+channel+enabled; bounded `days` query; no binary data. |
| `GET /api/guilds/:guildId/channels/:channelId/media` | Paginated attachment/sticker metadata and optional external Discord links | Admin+channel+enabled; bounded `limit`/`before`; no binary data. |
| `PATCH /api/guilds/:guildId/channels/:channelId` | Enable/disable recording | Admin+channel+Origin+CSRF, JSON `{ "enabled": true/false }`; enabling checks bot channel permissions. |
| `DELETE /api/guilds/:guildId/channels/:channelId/messages` | Purge that channel's archive rows | Admin+channel+Origin+CSRF; JSON `{ "deleted": number }`; source Discord messages untouched. |

The rate limiter relies on the server's view of client IP. `TRUST_PROXY=loopback` is an explicit opt-in for a trusted **same-host loopback proxy**; unset means Express does not trust proxy headers. In front of a proxy, test the limiter's client-IP behavior and never enable forwarding trust for an untrusted network.

### Read the React file as a guided tour

`web/index.html` provides `<div id="root"></div>` and loads `web/src/main.jsx` as a module. `createRoot(...).render(<App/>)` mounts React there. Vite builds those files and `styles.css` into static assets in `web/dist`. In a React component, a function returns JSX (HTML-like syntax); a `useState` value holds client UI state; `useEffect` runs after rendering and can fetch data; `useMemo` caches a derived value; `useCallback` keeps a callback reference stable. Consult the [official React learning guide](https://react.dev/learn) alongside the code.

- `Icon`, `Logo`, `Avatar`, and date/number formatters are reusable presentation pieces. `Avatar` falls back to initials if an image fails. URLs for avatars/guild icons refer to Discord CDN assets; the backend CSP allows that origin.
- `api(path, options)` calls same-origin `fetch` with cookies, conditionally adds JSON `Content-Type`, parses JSON responses, and throws an Error carrying an HTTP status on failure. It does **not** automatically add a CSRF header; callers performing mutations must obtain and pass one. Do not store the bot token or OAuth client secret in this file: browser bundles are public.
- `App` starts in `loading`, asks `/api/me`, then selects login or the authorized dashboard. Its login button is an ordinary link to `/auth/discord`, so the server controls OAuth, not JavaScript handling of the secret. A `401` in guarded views resets frontend session state; a `403` can display an access notice. Logout fetches a CSRF token before its protected POST.
- `Login` offers a Discord sign-in link and, when configured, a bot-installation link; no synthetic preview button is available. The decorative text is marketing presentation; read the limitations above rather than inferring features from the visuals.
- `Dashboard` holds selected guild/channel/view, channel list, loaded message pages, stats and chart range, search text, pending mutations, error messages, and purge confirmation. Its effects request the channel list when the guild changes, message rows when the archive view/selected enabled channel changes, and stats when the Statistics view/selected enabled channel/date range changes. Media metadata is requested only in the Media & stickers view for the selected enabled channel. Cleanup flags prevent some obsolete asynchronous responses from updating state after selection changes; they are not an access-control layer.
- `Sidebar`, `Overview`, `Archive`, the Statistics and Media & stickers views, and `Settings` render navigation, summary, message list, authorized statistics/metadata, and admin controls. `Settings` calls `/api/csrf` before each enable/disable or purge and shows a confirmation modal for purge. UI toggles cannot bypass API permissions.
- `MessageRow` renders stored text as a JSX expression in a normal element, not `dangerouslySetInnerHTML`. Content is untrusted; preserve this property in future changes. `Archive` filters **loaded** `messages` by author/content client-side; there is no server-wide search endpoint. “Load more” uses `nextBefore` to request another 50 and deduplicates seen IDs. A search with no results may mean “not in the loaded pages,” **not** “never archived.”
- `Chart` sorts daily values by date, draws an SVG polyline, and has an accessible `aria-label` summarizing day counts. The dates from the backend use UTC ISO date substrings; `formatDate` uses the browser's locale/timezone to display dates, so around midnight a label can differ from a user's intuitive local day. Treat this as a reporting limitation, not a timezone-configurable analytics feature.
- There are no in-browser synthetic fixtures or preview controls. A portfolio illustration should use invented, consenting test-server messages, not private archived content. Statistics and Media & emotes report authorized aggregate counts, popular emotes/stickers, and attachment/sticker/emote metadata (including optional external Discord-hosted links). Supported sticker/custom-emote images can display as browser-loaded Discord CDN thumbnails. Known Lottie stickers use a self-bundled light canvas renderer that fetches bounded, self-contained JSON from the Discord CDN only when visible; it rejects URLs/assets/expressions, follows reduced-motion preferences, and fails closed if unavailable. Ambiguous old stickers with no recorded format stay unpreviewed rather than guessed. ArchiveMe's server does not fetch, store, serve, or download sticker files.

## 11. Daily analytics, pagination, and accuracy limits

The statistics endpoint serves **counts by day and hour and category summaries for one selected, enabled, permitted channel**. A separate media endpoint lists available attachment/sticker metadata and optional external Discord links. Neither endpoint stores or returns binary files; messages archived before metadata collection may lack that metadata. `dailyStats` selects `substr(created_at,1,10)` as a UTC-looking date key, counts rows whose `deleted_at IS NULL` and `created_at` falls within the chosen start date, builds zero-filled `daily` entries for each day, then sums them into `total`. In this implementation delete events remove rows instead of setting `deleted_at`, so deleting a message lowers past counts. Edits update body and edit time, not the original `created_at`: they do not create another count. Pruning removes old rows and reduces historical counts. `total` is **the total within the requested chart window**, not a lifetime total. The Overview's “Archived messages” card sums the stored `messageCount` from channel-list responses across currently visible channels, while excluding disabled channels whose archive count is deliberately hidden; that count is not the same as the selected channel's period total. A disabled channel's message bodies, media metadata, stats, and archive count remain inaccessible.

For example, suppose `#archive-lab` has three retained messages on Monday, zero on Tuesday, and one on Wednesday in UTC. A 7-day stats response contains **seven** `{date, count}` objects, with the remaining dates filled with zero, and `total:4`. If an observed Discord delete removes one of Monday's stored rows, the next stats request can show Monday `2` and `total:3`. A message from a bot is never inserted and never counted. A missed delete can leave an incorrectly high count until another deletion path/purge/retention cleanup. The Statistics and Media & stickers views use archived data for an authorized channel; old message records may lack attachment/sticker metadata collected only for new messages.

The message API retrieves `limit + 1` rows to know whether more exist, returns at most `limit`, and computes `nextBefore` as the last returned ID if an extra row exists. The frontend passes that ID to `before` for its next page. Pagination is **not a snapshot**: concurrent messages, deletions, edits, or purges can change what appears between requests. The UI deduplicates IDs it has already loaded, but it cannot guarantee a complete stable export. `limit=0`, `limit=101`, invalid `before`, `days=0`, and `days=91` are rejected. The backend intentionally has no analytics across all hidden/private channels and no content search endpoint; adding either demands independent permission checks and privacy review.

## 12. Testing, debugging, and failure modes

Run the existing automated checks locally:

```sh
npm test
npm --prefix web run build
npm run check          # tests then root web build; not a full security audit
npm audit --audit-level=high
```

The test suite uses Node's built-in test runner and an **in-memory SQLite DB**. `test/analytics-media.test.js` covers attachment/sticker metadata, safe URL handling, UTC statistics, migration, retention and pagination, and access controls. It does not connect to a real Discord account or prove end-to-end Portal configuration. `test/security.test.js` exercises unauthenticated and non-admin denials, channel-specific access, channel isolation, CSRF/Origin, disabled read denial, input bounds, opt-in recording, edit/delete behavior, and idempotent create handling. `test/oauth.test.js` mocks Discord OAuth responses to verify `identify`, PKCE, short-lived single-use state, and hashed local sessions. The GitHub workflow on push/PR checks out code, sets Node `24.12.0`, installs root dependencies, runs tests, installs/builds frontend, then runs high-severity npm audit. Tests passing does not mean runtime Discord policy approval, a threat-model review, browser accessibility audit, restore success, or safe production operations.

| Symptom | Start with these concrete checks; do not weaken permissions to hide the problem |
| --- | --- |
| Node reports missing `node:sqlite` or unsupported syntax | `node --version`; install the supported engine from root `package.json`, then use both lockfiles. |
| Root says frontend is not built | `npm --prefix web ci && npm --prefix web run build`; run server from repository root so default `web/dist` resolves correctly. |
| Bot says it is not configured; `/ready` is 503 | With no credentials this is expected, but the sign-in page is not an archive demo. For test-server mode check secret variables are actually exported to the server process, app ID matches token, Portal intent, and connectivity. |
| Discord bot fails to start | Check logs, token validity, privileged intent configuration/eligibility, outbound access, and command registration rights. Do not disclose the token while seeking help. |
| OAuth “redirect_uri” mismatch or failed login | Check `BASE_URL` + `/auth/callback` exactly matches registered redirect; `localhost` vs `127.0.0.1`, HTTP vs HTTPS, and port matter. Check ID/secret for the same application and state-cookie presence. Retry the whole login; do not replay a used callback. |
| Login succeeds but no guild is listed | Is the bot in that guild and ready? Does that Discord user currently have Manage Server? The app does not ask for OAuth `guilds` scope and does not grant member browsing. |
| Channel missing or denied | Is it an ordinary guild text channel? Does the manager personally have View Channel **and** Read Message History? Can Discord fetch that channel? A cached UI may need refresh, but direct API always rechecks. |
| Enabling returns bot-access error | Check the bot's effective View Channel and Read Message History permissions on that exact channel, including overwrites. No need for Administrator. |
| New messages absent or empty | Was channel enabled before they were sent? Are they non-bot messages in `GuildText`? Is Message Content intent configured/allowed? Is bot connected and authorized for that channel? Existing history is not imported. |
| Edits/deletes don't show | Re-fetch the website; was an event received, and was the message already archived? Check logged edit-fetch errors. Bot downtime can create permanent gaps; no reconciliation exists. |
| `403 Invalid origin` or `Invalid CSRF token` | Use the same origin as `BASE_URL`; let UI fetch `/api/csrf` immediately before a mutation; tokens rotate. If a second tab rotated your CSRF token, obtain a fresh one and retry rather than disabling protection. |
| `429` | Look for excessive refreshes or proxy/IP effects; do not evade Discord API rate limits. Review reverse-proxy/client-IP treatment before changing app rate limiter. |
| Chart looks different from message count | Check selected channel and range, UTC day boundaries, disabled status, pruning/deletes, and whether older messages lack category metadata. Overview count and selected date-window total mean different things. |
| Process starts but storage disappears after restart | Verify `DATABASE_PATH` points to an attached persistent private disk, not an ephemeral deployment directory; inspect service-user write permissions. |
| Restore gives old data or stale access | A backup is a historical snapshot. After restore, verify current Discord permissions, prune, backups' deletion obligations, and any stale sessions; see restoration section. |

**Debug safely:** use invented data, record status codes instead of private response bodies, redact cookies/tokens/OAuth codes, and test one scenario at a time. Browser developer tools show requests/responses; terminal logs show startup/edit/command failures. Do not paste real message bodies or credentials into public bug reports. For deeper local code reading, set breakpoints near route middleware in `src/app.js` and bot event handlers in `src/discord.js`, but do not expose Node's debugger port on a public network.

## 13. GitHub and a careful Git workflow

GitHub is a code host and collaboration/CI service, **not** ArchiveMe's bot process, database, backup destination, or a substitute for Discord permissions. The source code is now published in the public [seaprisoners/ArchiveMe GitHub repository](https://github.com/seaprisoners/ArchiveMe) as several real milestone commits. Publishing code does **not** provision a hosted runtime; this installation is intentionally local-only. Verify the remote with `git remote -v` and check GitHub's website to distinguish local commits from pushed commits. The existing CI workflow runs on push and pull request; it does not deploy. Refer to official [GitHub repository creation](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository), [GitHub authentication](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github), [Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), and [sensitive-data removal](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

A beginner-friendly sequence, **on your own clone/repository** rather than blindly modifying someone else's remote:

```sh
git status --short                 # review what's changed; this checkout may have untracked files
git diff --check                   # detect whitespace mistakes in tracked modifications
npm test
npm --prefix web run build
git add README.md package.json package-lock.json .gitignore .env.example \
  src/ web/package.json web/package-lock.json web/index.html web/src/ \
  test/ .github/workflows/ docs/
git status --short                 # inspect the staged list before committing
git diff --cached --stat
git commit -m 'Document and test ArchiveMe'
# Create your own GitHub repository first, then, after reviewing your remote URL:
git remote add origin https://github.com/seaprisoners/YOUR-REPO.git
git push -u origin YOUR-BRANCH
```

The `git add` example is deliberately explicit: your actual staged list depends on what belongs in **your** repository. If a remote already exists, **do not** run `git remote add origin` again; use `git remote -v` and confirm destination before pushing. `YOUR-BRANCH` is your intended branch; obtain it with `git branch --show-current`. If this checkout is untracked rather than committed, `git diff --check` alone does not inspect every new file, and `git diff` alone will not show new-file content; inspect the staged diff before commit. Never include `.env`, `data/`, `*.sqlite`, `*-wal`, `*-shm`, `node_modules`, or `web/dist`. Verify `git status --short` and, when uncertain, `git check-ignore -v .env data/archiveme.sqlite`. `.env.example` contains placeholder names and is intentionally trackable, but **do not fill its placeholders with real credentials**. Before creating screenshots, inspect the browser URL/logs for OAuth codes and private content.

Make a GitHub repo private until you have reviewed docs, code, licenses, sample data, and any secrets. Use a protected main branch, code review, least-privilege collaborators, and account MFA/passkeys. Treat CI jobs as code executing on runners: review dependency updates and external Actions; pin versions more tightly and grant minimal `GITHUB_TOKEN` permissions in a hardened future workflow. Current CI uses `actions/checkout@v4` and `actions/setup-node@v4` and **does not** set deployment secrets or publish a service. If you later create a deployment workflow, store credentials in a provider secret manager or appropriately scoped Actions secrets; restrict environment approvals and avoid printing them. GitHub Actions secrets do **not** configure a separately hosted Node process automatically.

**If a secret reaches GitHub:** stop using it, rotate/revoke it first in the Discord Portal or provider, remove accidental disclosure, investigate access and backups, then follow GitHub's official history-cleanup instructions with collaborators as appropriate. Deleting a line in the newest commit does not erase older commit history, forks, caches, screenshots, or logs. Never tell collaborators a history rewrite alone makes a previously exposed bot token safe. Avoid running `git push --force` without a coordinated recovery plan.

A healthy iteration: create a branch; make one small, reviewable change; run tests/build; stage only intentional files; inspect diff for secrets; open a pull request; explain the privacy/security impact; wait for checks/review; merge; deploy deliberately; observe `/ready`, logs, and backups. If presenting **gradual commit history**, make real, incremental commits as work is done with their actual timestamps; never backdate or manufacture a development history. Document migration steps if changing the DB schema. Git tags and GitHub releases are source snapshots, not SQLite restore points.

## 14. Deployment, TLS, persistence, and operations

**Do not deploy to a real community merely because local tests passed.** The following is a deployment *recipe and review framework*, not evidence a host was configured. Use one always-on host and one process with persistent local disk for this version. Configure DNS to a domain you control, firewall inbound traffic to the HTTPS reverse proxy, and terminate TLS there. The default Node listener is `HOST=127.0.0.1`, `PORT=3000`; keep it loopback-only if the proxy is on the same machine. On separate-host/proxy setups, `HOST` may need a private interface, but use private networking, firewall rules, authenticated operations, and security review—do not casually bind `0.0.0.0` and expose plain HTTP. No supplied server configuration or hosting account is created by this repository.

```text
Internet browser --HTTPS:443--> reverse proxy (TLS certificate)
                                |
                                +--HTTP localhost:3000--> ArchiveMe Node process
                                                         |
                                                         +--> private persistent disk
                                                         +--> Discord Gateway / REST
```

A **conceptual Caddyfile** for a same-host VPS, to adapt/verify against the official [Caddy reverse-proxy guide](https://caddyserver.com/docs/quick-starts/reverse-proxy) **(requires review: link not fetched in this handbook review)** and your host's network/security policy:

```caddyfile
archive.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

This is not a full hardened server configuration. Ensure domain DNS, certificate issuance/renewal, HTTPS redirects, proxy forwarding, body size, log retention, and firewall rules work before putting users on it. Set `BASE_URL=https://archive.example.com` **without a trailing slash** so the code constructs `https://archive.example.com/auth/callback` and exact Origin comparisons. Register that exact redirect in Discord. Use `NODE_ENV=production` to enforce HTTPS `BASE_URL` and all three Discord secrets. A production service might receive environment values via a secret manager/system service; the following command block has placeholders only:

```sh
# On your reviewed, trusted host, in a checked-out release directory:
npm ci
npm --prefix web ci
npm --prefix web run build
# Configure NODE_ENV=production, BASE_URL=https://archive.example.com,
# DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET,
# HOST=127.0.0.1, PORT=3000, DATABASE_PATH=/private/persistent/archiveme.sqlite
# and RETENTION_DAYS=90 via restricted environment/secret manager.
# Only for a trusted SAME-HOST loopback reverse proxy, optionally set:
# TRUST_PROXY=loopback
npm start
```

Set a dedicated **unprivileged service user** that can write only its intended database directory and runtime files; make secrets readable only by that account and trusted administrators. Run it with an actual service supervisor configured for restart on failure and bounded logs. Do not use ephemeral app-container storage for `DATABASE_PATH`; avoid NFS/network filesystems for SQLite WAL. Grant sufficient disk space for database + WAL + temporary operations + consistent backups. The process prunes once at startup and hourly; allow graceful `SIGTERM` for DB close. The service starts listening before bot startup completes, so readiness checks must use `/ready`, not `/health` or a mere open TCP port. A failing `/ready` means no live Discord bot; investigate promptly because missed messages are not backfilled. Monitor uptime, proxy TLS expiration, disk fullness, backup success and restore tests, bot disconnects/permission failures, and error logs **without logging private message bodies**.

**Operationally important limitations:** There is no built-in migration framework, backup scheduler, process manager, metrics endpoint, queue, retry worker, or distributed rate-limit store. `express-rate-limit` uses its configured default store for this one process. Code uses a single synchronous SQLite connection; scaling to multiple bot/API processes or a multi-host deployment needs a redesign, not just a larger load balancer. The app leaves Express `trust proxy` off unless `TRUST_PROXY=loopback` explicitly opts in to trusting the same-host loopback reverse proxy; any other nonempty value is rejected at startup. Never set this for an untrusted intermediary or expose the Node listener directly: untrusted forwarded IP headers can undermine IP-derived rate limiting; conversely, leaving it unset behind a proxy can make all users share the proxy's IP budget. Review Express [behind-proxies guidance](https://expressjs.com/en/guide/behind-proxies.html) **(requires review: link not fetched in this handbook review)** and test your actual topology. The TLS proxy protects transit, while encryption-at-rest and backup encryption are host/operator responsibilities. `NODE_ENV=production` is a configuration check, not a blanket security certification.

## 15. Backups, restoration, and deletion

A backup is a separate copy of personal data and should be treated as such. SQLite is configured in **WAL mode**; recent committed changes may reside in `archiveme.sqlite-wal`, with a related `-shm` file. **Do not copy only a live `.sqlite` file and call it a consistent backup.** Read the official [SQLite online backup API](https://www.sqlite.org/backup.html), [WAL file documentation](https://www.sqlite.org/wal.html), and [Node `sqlite.backup` API](https://nodejs.org/api/sqlite.html#sqlitebackupsourcedb-path-options). The app itself does **not** implement automatic backups. The following optional operator command demonstrates a **one-off consistent snapshot**, not an added feature, schedule, or substitute for restore testing:

```sh
# Set SOURCE to your actual live SQLite path; DEST must be a separate secure location.
# Do not save backups inside Git or a publicly served directory.
export SOURCE='/private/persistent/archiveme.sqlite'
export DEST='/private/backups/archiveme-snapshot.sqlite'
node --input-type=module -e '
  import { DatabaseSync, backup } from "node:sqlite";
  const source = new DatabaseSync(process.env.SOURCE, { readOnly: true });
  try { await backup(source, process.env.DEST); console.log("Backup completed"); }
  finally { source.close(); }
'
```

Before using this in production, test this exact Node version/API on your platform, confirm destination permissions and free space, ensure the destination name will not overwrite an important prior backup, and verify the backup's integrity. The illustrated read-only open should fail for a missing source file; other, non-read-only SQLite open commands can create a new empty DB for a wrong path. Independently check source existence and contents before trusting any snapshot. A controlled offline backup after clean shutdown may be possible, but WAL recovery/checkpoint behavior must be understood—use documented SQLite methods rather than improvising a live-file copy. Automate snapshots with a reviewed scheduler, restrict access, encrypt them at rest/in transit, store an appropriately isolated copy, rotate keys, set expiry, and monitor failures. Avoid dumping session tokens/CSRF/verifiers or private text into tickets/logs. Store any restoration credentials separately.

**A safe restoration drill:** (1) Choose a **test/staging** destination isolated from real users and Discord bot credentials. (2) Verify backup identity, age, provenance, encryption, checksum/integrity, and retention/deletion obligations. (3) Stop any application using the **test destination**; take a verified current snapshot before replacing anything. (4) Put the restored DB on a private persistent disk accessible only to its test process. (5) Use a SQLite integrity check, for example with the `sqlite3` CLI if installed: `sqlite3 /private/staging/archiveme.sqlite 'PRAGMA integrity_check;'`—expect `ok` for this check, but remember logical privacy correctness requires more. (6) Start an isolated app and verify tables, counts, guild/channel associations, expiry cleanup, and authorized access with **synthetic** data. (7) Confirm no stale OAuth sessions should be honored; consider removing restored `sessions` and `oauth_states` under a documented operator procedure, not an accidental raw SQL change. (8) Record restore time and differences from the live source; only then consider a carefully reviewed production restore during maintenance.

**Deletion paradox:** Purge deletes live rows and an observed Discord delete removes a live row, but a snapshot from yesterday may still contain it. Restoring yesterday's snapshot can reintroduce material previously deleted or data past current retention, along with old sessions and authorization metadata. You need a **backup deletion/expiry policy**, a way to honor justified deletion requests across live data and relevant copies, access controls, and a post-restore reconciliation procedure. This repository does not implement those workflows. Disabling a channel is not deletion. A physical SQLite file may retain unallocated bytes after SQL deletion depending on SQLite/storage behavior, and remote backups or browser screenshots cannot be erased by one `DELETE` statement; do not assert irreversible erasure without an independently reviewed secure-deletion plan.

## 16. Discord terms, privacy, and informed-consent review

Discord documentation and rules evolve; verify the current [Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy) **(requires review: automated access returned HTTP 403)**, [Developer Terms](https://support-dev.discord.com/hc/en-us/articles/8563935748247-Discord-Developer-Terms-of-Service) **(requires review: automated access returned HTTP 403)**, [OAuth2 documentation](https://docs.discord.com/developers/topics/oauth2), [privileged intent review](https://docs.discord.com/developers/gateway/getting-started-with-privileged-intent-review), and applicable privacy/data-protection law before real deployment. The developer/operator—not this README, guide, or code—must decide whether the collection purpose, eligibility, legal basis, notices/consent, data transfers, member rights, deletion, security, and retention are appropriate in the specific community/jurisdiction. Seek qualified legal advice when necessary. **Do not assert that admin opt-in alone settles members' privacy rights or Discord-policy compliance.** Do not attempt to bypass intent approval, automate a normal user account, harvest nonconsenting servers, or evade API limits.

### Consent and privacy worksheet for a server owner

- [ ] **Purpose:** Can we explain in plain language *why* each channel is archived, why messages' author IDs/names/avatar URLs are necessary, and who benefits? If not, do not enable it.
- [ ] **Scope:** Are the server and every selected channel appropriate? All channels start off; keep staff, medical, financial, legal, crisis, minors', or other sensitive spaces out unless independently reviewed. DMs, threads, attachment/sticker **binary files**, voice, and historical imports are not collected by this implementation; attachment/sticker metadata may be recorded for new messages, not recovered for old records. Accurately state that scope and its limitations.
- [ ] **Notice before collection:** Tell participants when collection begins, exact channel list, captured fields/content, admin-only viewer group, host/jurisdiction, retention (default 90 days), backups, contact point, and process for questions/requests. A notice after collection is not the same as a meaningful prior choice.
- [ ] **Consent/legal basis:** Determine whether your jurisdiction/community requires consent from each participant or another lawful basis, how people opt out/leave/ask for deletion, and how new members learn of the practice. An admin's button click is a technical opt-in, not by itself legal consent from everyone affected.
- [ ] **Authorization:** Which accounts can get Manage Server? Do those accounts also have channel-specific View/History access? Have you reviewed channel overwrites, shared machines, screenshots, backup operators, and what happens when an admin leaves?
- [ ] **Content eligibility:** Confirm Message Content privileged intent configuration and any review/approval needed for the app. Stop if permissions or approval are unavailable; do not convert to a selfbot.
- [ ] **Retention:** Decide a justified value for `RETENTION_DAYS`, backup lifetime, audit-event lifetime, session expiry, privacy-request handling, and deletion of legacy copies. Document that code has no automatic audit/backups cleanup.
- [ ] **Deletion response:** Specify how to disable collection, purge a channel, handle missed Discord deletes, remove retained backup copies where required, and reconcile after restoration. Say honestly what cannot be undone (a recipient's screenshot or prior download).
- [ ] **Security and incidents:** Protect token/client secret, server and DB filesystem, HTTPS, logs, backups, access reviews, incident reporting and credential rotation. Have a procedure for an exposed token or unintended channel enablement.
- [ ] **Transparency of accuracy:** State that the archive can be incomplete or stale and cannot prove what every person said at a moment; don't use it as a legal/disciplinary definitive record without independent validation.
- [ ] **Public presentations:** Use invented content in a consenting test server for screenshots, portfolio posts, bug reports, and docs. Never upload real private guild messages to GitHub to illustrate a chart.
- [ ] **Change control:** Revisit notice and review before changing who can read, adding search/export, changing data retention, adding attachment/sticker binary storage or threads, enabling a new channel, or moving hosts.

A model notice you can **adapt only after review**, not a ready-made compliance document:

> In `#archive-lab` only, beginning after [start date/time and time zone], our independently hosted ArchiveMe bot will store the text of new non-bot messages, author Discord ID and displayed name, avatar URL, message/channel/server IDs, and creation/edit times. Server managers with current Manage Server and current permission to view/read this channel can browse retained messages and daily counts. Default live-message retention is [actual configured days]; backup retention is [actual documented period]. The bot may miss events; it does not collect prior history. Contact [real contact and request method] for questions, withdrawal/deletion requests, and details of our host/location and policy. [Explain lawful basis/consent mechanism approved for this community.] Do not post sensitive data here if you do not accept the described scope.

Do not publish that notice with blank fields. Discord's Terms, the operator's privacy obligations, and hosting law may require more than this sample; a notice is not a substitute for policy review, lawful authorization, and actual technical enforcement.

## 17. Deployment action checklist

**Current status versus remaining human actions:** the source repository and CI are public at [github.com/seaprisoners/ArchiveMe](https://github.com/seaprisoners/ArchiveMe). In a local, consenting test-server session, the official bot connected, Discord OAuth login showed the admin dashboard, and one newly enabled test channel archived one test message; `/ready` returned `200`. The website is reachable **only on this computer** at `http://localhost:3000/`, not on the public internet; there is no in-browser synthetic preview, and archive views require an authorized Discord login. All real credentials are in an ignored owner-only `.env` file, never in GitHub. Outside this limited test, production HTTPS hosting, consent/notice for additional members, current Discord policy review, persistent secure infrastructure, backups, and reliable operational checks still require deliberate human/operator action. GitHub publishing does not host the runtime or database.

Use this as a **gate**. Any unchecked critical item means keep the application in the consenting test-server stage. Mark completion with evidence and an owner/date in your own operational records rather than treating this markdown as proof.

### Before touching real community data

- [ ] Read current official Discord policy/terms and check Message Content eligibility/approval; record date and any outstanding legal questions. The two policy links in this guide are **requires-review** because automated retrieval failed.
- [ ] Identify a lawful purpose and appropriate notice/consent or legal basis for **members**, not only the server administrator; review sensitive-channel exclusions.
- [ ] Create separate test and production Discord applications/credentials if operations require isolation, and review the Portal's current install configuration.
- [ ] Inventory exactly which guild/channel IDs will be enabled; channel defaults are off. Confirm bot and human effective permissions separately; no Administrator shortcut.
- [ ] Choose/document live-message, audit-metadata, backup, log, and session retention and a deletion-request workflow; review the code's actual gaps.

### Prepare infrastructure

- [ ] Install supported Node and lockfile dependencies; run tests, frontend build, audit, and privacy/security code review.
- [ ] Provision a single reviewed always-on host/service user and **persistent private local disk** for SQLite/WAL; verify owner permissions, space, restart behavior, and graceful shutdown.
- [ ] Put HTTPS reverse proxy and valid certificate in front; firewall private Node port. Match `BASE_URL` origin, reverse-proxy domain, and Discord OAuth redirect exactly.
- [ ] Set `NODE_ENV=production` and all three credentials through a restricted secret manager; do not place secrets in code, build assets, Git history, public logs, or screenshots.
- [ ] Test correct client-IP/rate-limit behavior behind the proxy: set `TRUST_PROXY=loopback` only for a trusted same-host loopback proxy; otherwise leave it unset. Verify no direct plain HTTP internet path.
- [ ] Define log/alert ownership, token-rotation procedure, SSL renewal checks, disk usage alerts, and `/ready` monitoring. `/health` alone is insufficient.

### Protect and test data

- [ ] Schedule **consistent** SQLite snapshots using a reviewed method, encrypt and expire them, restrict access, verify integrity, and practice an isolated restoration.
- [ ] Document how channel purge, bot removal, legal deletion requests, and retention changes affect backups and restored data; test post-restore cleanup of expired/deleted rows and stale sessions.
- [ ] Exercise a consenting new message, edit, delete, disable, re-enable, and purge; verify unauthorized and channel-denied reads fail, and annotate gaps/limitations in user-facing notice.
- [ ] Verify no real private data enters GitHub, screenshots, analytics logs, test fixtures, or documentation.
- [ ] Have a stop-collection plan: disable channel, revoke bot access if necessary, preserve evidence responsibly, purge reviewed data, rotate secrets following exposure, and inform stakeholders where required.

### Go/no-go decision

- [ ] Responsible owner signs off on policy/privacy review, operational runbook, disaster-recovery drill, data-access review, and residual risk. Otherwise **do not enable real channels**.
- [ ] After launch, periodically recheck Discord terms and permission semantics, dependencies, service health, retention/purge correctness, backup restore ability, and users' notices.

## 18. Further reading and link-review status

These are **external reference links**, not instructions to change this repository. Official documentation can change; re-open it at deployment time. During preparation, the following endpoint pages were fetched successfully: [Discord Gateway](https://docs.discord.com/developers/events/gateway), [Gateway events](https://docs.discord.com/developers/events/gateway-events), [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2), [Discord permissions](https://docs.discord.com/developers/topics/permissions), [Discord bot overview](https://docs.discord.com/developers/bots/overview), [privileged-intent review](https://docs.discord.com/developers/gateway/getting-started-with-privileged-intent-review), [Node SQLite API](https://nodejs.org/api/sqlite.html), [Node environment-file CLI](https://nodejs.org/api/cli.html#--env-filefile), [Express 5 API](https://expressjs.com/en/5x/api/), [React learning guide](https://react.dev/learn), [SQLite online backup](https://www.sqlite.org/backup.html), [SQLite WAL](https://www.sqlite.org/wal.html), [GitHub repository creation](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository), [GitHub authentication](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github), [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets), and [GitHub's sensitive-data removal guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository). Successful retrieval verifies a page responded, **not** that this particular app complies with every rule on it.

**Requires review before relying on the link:** [Discord Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy) and [Discord Developer Terms](https://support-dev.discord.com/hc/en-us/articles/8563935748247-Discord-Developer-Terms-of-Service) returned automated HTTP 403; open them manually and confirm current texts. The official-looking [Caddy reverse-proxy guide](https://caddyserver.com/docs/quick-starts/reverse-proxy), [Express middleware guide](https://expressjs.com/en/guide/using-middleware.html), [Express behind-proxies guide](https://expressjs.com/en/guide/behind-proxies.html), [Node crypto guide](https://nodejs.org/api/crypto.html), and [SQLite foreign-key guide](https://www.sqlite.org/foreignkeys.html) were referenced but not individually fetched for verification here, so **review these URLs and their current guidance before operational use**. The main Discord Developer Portal application page is [here](https://discord.com/developers/applications); Portal UI and login-dependent settings require direct manual review. Nothing in these citations should be read as a claim of Discord endorsement, policy approval, or legal sufficiency.

---

**Learning checkpoint:** if you can explain why (1) a bot with an official token receives only opted-in new text-channel events, (2) OAuth `identify` says who is logged in but **not** what archives they may read, (3) the API asks Discord again about both guild and channel permissions, (4) disabling differs from purging, and (5) a SQLite backup can outlive a deletion, you have the key mental model for extending ArchiveMe responsibly. If any of those statements sounds uncertain, read the linked source and repeat the consenting test-server exercise before deploying.
