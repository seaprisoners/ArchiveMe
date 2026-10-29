# ArchiveMe: start here

ArchiveMe helps a Discord server manager keep a **small, opt-in archive** of messages. This guide is for someone who has never run a bot or used a terminal. The built-in pretend-data preview has been removed; try the website with a consenting test server and invented messages.

**Already set up on this computer?** You have a local Discord test application and an ignored private `.env` file. To use it, open a terminal, run `cd ~/Documents/ArchiveMe`, then `node --env-file=.env src/index.js`. Leave that terminal open. Visit [http://localhost:3000/](http://localhost:3000/) on this same computer; choose Discord login; there is no fake-data preview. If the terminal says the port is already in use, the app may already be running: open the page first rather than starting another copy. The code is public at [GitHub](https://github.com/seaprisoners/ArchiveMe), but the live website is **not** publicly hosted.

**Want the full technical explanation?** The original, detailed handbook is preserved in the [technical reference](TECHNICAL_REFERENCE.md). You do not need it to start. To change the appearance, use the short [website redesign guide](REDESIGN_WEBSITE.md).

> **Start with invented messages in a test server.** A manager switching on a channel is not, by itself, permission from every member to store their messages. Do not use this as an unnoticed archive of a real community.

## Contents

1. [The idea and what works today](#1-the-idea-and-what-works-today)
2. [Install the project without connecting a bot](#2-install-the-project-without-connecting-a-bot)
3. [Set up a Discord test bot](#3-set-up-a-discord-test-bot)
4. [Connect the app on your computer](#4-connect-the-app-on-your-computer)
5. [Try one opted-in test channel](#5-try-one-opted-in-test-channel)
6. [Keep people and data safe](#6-keep-people-and-data-safe)
7. [Optional hosting and website changes](#7-optional-hosting-and-website-changes)
8. [Troubleshooting and small glossary](#8-troubleshooting-and-small-glossary)

## 1. The idea and what works today

Imagine putting a labeled notebook beside **one** Discord channel. The bot writes down *new* messages only after a manager opens that notebook for the channel. The website lets an authorized manager read the notes. Turning the notebook face down hides it, but does not erase its pages. **Purge** tears out its saved pages; it does not erase the original Discord messages or old backup copies.

ArchiveMe has three parts that work together on your computer: a Discord bot, a website/API server, and a SQLite database file. The browser shows the website. GitHub holds the code, **not** a running public website or a hosted archive. The current project is an educational, early-stage app, not an audited service.

**What is implemented:** A server manager can enable or disable individual ordinary server text channels with the dashboard or `/archive enable` and `/archive disable`. New channels start **off**. For enabled channels, the bot records new non-bot text messages, applies edits when it sees them, and removes saved messages when it sees their deletion events. The manager can view saved messages and a daily message-count chart, or purge a channel's saved messages. Messages normally age out after 90 days. The website has a **Statistics** and **Media & stickers** views for authorized managers: message activity, hourly/category summaries, and attachment/sticker names, types, sizes, and Discord-hosted links where available. It stores metadata only, not attachment or sticker files; ArchiveMe does not fetch, serve, or download binary files. A person can choose to open an external Discord link, which may expire. Older archived messages may lack metadata permanently. The former synthetic preview is no longer available.

**Who can read the real archive:** The signed-in person must currently have Discord's **Manage Server** permission and **View Channel** plus **Read Message History** for the particular channel. The server checks again for protected requests. Regular members do not get an archive view. A Discord login by itself is not a pass to see messages.

**What is not implemented:** There is no import of old messages, all-server search, full-text database search, member dashboard, synthetic or public real-data demo, export, attachment/sticker **file storage or download**, thread archive, DM archive, voice archive, automatic backup, or hosted service. Search on the message page checks **only messages already loaded in that browser**. The bot can miss messages or deletions while it is offline. It is not a complete copy of Discord. Do not rely on it as a definitive history.

On the **front page**, you may see **Add bot to your server**. The website gets that link from `/api/public-config`. The link appears **only when a valid application ID is configured and the bot is connected and synchronized**. Otherwise, the page says installation is unavailable. That link requests the `bot` and `applications.commands` scopes and bot permissions for View Channel and Read Message History. It does **not** switch on any channel. The front page also offers **Continue with Discord** for *human website login*. These are different actions.

## 2. Install the project without connecting a bot

You need [Node.js](https://nodejs.org/en/download) version **24.12.0 or later within version 24, or version 26 or later**, plus npm. Installing Node usually installs npm too. You do **not** need a bot token for this section.

Open a **terminal**: on Linux or macOS, search your computer's applications for “Terminal.” A terminal is a window where you type a command and press **Enter**. Type only the commands inside the boxes, not any `$` symbol you might see in other tutorials. These commands assume a Linux/macOS-style shell.

Make sure the terminal is in the ArchiveMe folder, the one containing `package.json`. On this computer, that folder is `~/Documents/ArchiveMe`. If you cloned this project somewhere else, replace that first line with your own folder's path. `cd` means “go to this folder”; `pwd` prints the folder you are in.

```sh
cd ~/Documents/ArchiveMe
pwd
node --version
npm --version
```

If `node` is missing or the version is too old, install a supported version before going on. The first two install commands download the server and website packages. The third turns the website source into files the server can display. Run these from the ArchiveMe folder:

```sh
npm ci
npm --prefix web ci
npm --prefix web run build
npm test
```

Now start the server **without loading a `.env` file**:

```sh
npm start
```

Leave this terminal open. In a browser **on the same computer**, open [http://localhost:3000/](http://localhost:3000/). You can see the sign-in page, but without Discord credentials there is no usable dashboard and **no synthetic preview**. Next, follow the test-bot steps below to access Overview, Message archive, Statistics, Media & stickers, and Channel settings with invented messages in a consenting test server.

`npm start` does not read `.env` automatically. **But** if you previously set Discord credentials in this terminal's environment, it may still connect the bot. To check an intentionally disconnected sign-in page, use a fresh terminal without exported credentials and do not load `.env`. Press **Ctrl+C** in the server terminal to stop it when you are done.

You can inspect two simple status pages while the server is running: [http://localhost:3000/health](http://localhost:3000/health) and [http://localhost:3000/ready](http://localhost:3000/ready). `/health` can say the process is healthy even without a bot. `/ready` returns an unavailable result until a bot is connected **and** its initial server/channel sync succeeds. That is normal before test-bot setup.

## 3. Set up a Discord test bot

Only continue if you have **your own test server** and a text channel for invented messages. Tell every test participant what will be stored. If you cannot do that, do not enable archiving; there is no synthetic preview.

1. Open the official [Discord Developer Portal](https://discord.com/developers/applications). Create a **new application**. Copy its **Application ID**. Later it goes in `DISCORD_CLIENT_ID`.

2. In that application's **Bot** area, obtain the **bot token**. Later it goes in `DISCORD_BOT_TOKEN`. Treat it like a password. Check the **Message Content** privileged intent in the Portal if Discord permits it and you need readable message text. This app requests that intent when connecting. Discord may require extra approval; never work around that with a normal user's token or a “selfbot.” Read the official [bot guide](https://docs.discord.com/developers/bots/overview) and [privileged-intent guidance](https://docs.discord.com/developers/gateway/getting-started-with-privileged-intent-review).

3. In the application's **OAuth2** settings, obtain its **client secret** for `DISCORD_CLIENT_SECRET`. Add this exact local redirect URL: `http://localhost:3000/auth/callback`. Keep `localhost` consistent with `BASE_URL` and the address you open in the browser. `127.0.0.1` is not the same hostname for this login. See [Discord's OAuth2 documentation](https://docs.discord.com/developers/topics/oauth2).

4. **Install the bot in your test server.** If this site already runs with its bot configured, connected, and synchronized, its front page displays **Add bot to your server**. Otherwise, use the Developer Portal's current installation/OAuth2 URL generator. Choose a server install with `bot` and `applications.commands` scopes. Give the bot only **View Channel** and **Read Message History** in the test channel. Check any channel permission overrides. Do **not** grant Administrator to fix an access error. Discord may change the Portal's labels; use its current [installation and permissions documentation](https://docs.discord.com/developers/topics/permissions).

5. Pick a Discord account that can manage this test server. That **person** needs **Manage Server**, plus **View Channel** and **Read Message History** on the test channel. The bot needs its own channel permissions separately. Installing the bot does not sign you into the website. Signing in does not install the bot or enable a channel.

The bot's `/archive` command is registered when the configured app starts. It may take time to appear in Discord. You can also use Channel settings on the website once the bot is connected and your manager account is signed in.

## 4. Connect the app on your computer

We need to give the running app three values: bot token, application ID, and OAuth2 client secret. Keep them **out of code, screenshots, chat messages, and GitHub**. The tracked `.env.example` contains placeholders, not working credentials. A private local `.env` is an easy option.

After stopping the credential-free server with **Ctrl+C**, go back to the ArchiveMe folder. If you have **never made a `.env` file**, run:

```sh
cd ~/Documents/ArchiveMe
umask 077
nano .env
```

`umask 077` makes newly created files private to your account on a typical Linux/macOS system. `nano` opens a basic text editor **inside the terminal**. If `nano` is unavailable, use a local text editor to create a file named `.env` in this same folder; keep its permissions private. **If `.env` already exists, open it instead of overwriting it. Never share its contents to get help.**

In the editor, add these lines. Replace only the three `replace-...` values with your real **test** credentials. Do not put spaces around `=`. Leave `BASE_URL` exactly as shown for this local setup:

```dotenv
DISCORD_BOT_TOKEN=replace-with-your-test-bot-token
DISCORD_CLIENT_ID=replace-with-your-application-id
DISCORD_CLIENT_SECRET=replace-with-your-oauth-client-secret
BASE_URL=http://localhost:3000
HOST=127.0.0.1
PORT=3000
DATABASE_PATH=./data/archiveme.sqlite
RETENTION_DAYS=90
```

In nano, press **Ctrl+O**, then **Enter** to save. Press **Ctrl+X** to leave. Run `chmod 600 .env` if the file was created with another editor or already existed. The private `data/` folder holds the SQLite database; do not publish it. `.env` is ignored by Git, but check what you upload rather than relying only on that safeguard.

Load `.env` **explicitly** when you start the app:

```sh
chmod 600 .env
node --env-file=.env src/index.js
```

Node's `--env-file=.env` goes **before** `src/index.js`. Plain `npm start` does not load the file. Keep the terminal open and watch for bot connection or startup errors. Open [http://localhost:3000/](http://localhost:3000/) on the same machine. Click **Continue with Discord** and sign in on Discord's own page. The site asks for the `identify` login scope; it does not ask for your Discord password or give website users the bot token.

If you cannot see a server after signing in, check that the bot is in that server and your signed-in account has **Manage Server**. A successful login alone does not grant access. You can stop the process with **Ctrl+C**. The local database remains on disk unless you deliberately remove it; never assume stopping the server erases stored messages.

## 5. Try one opted-in test channel

Start with a new ordinary text channel such as `#archive-lab`. Use only invented, nonsensitive messages from people who agreed to this exercise. Channel settings should show it **off** at first.

1. Post `before opt-in` in Discord. It should **not** later appear in ArchiveMe. The app does not import old messages.
2. On the signed-in website, open **Channel settings** and switch on just `#archive-lab`. Or, as a permitted manager in Discord, use `/archive enable channel:#archive-lab`. Check the bot and the manager can both view and read history in that channel.
3. Post `hello from my test channel` **after** enablement, using a non-bot test account. Open **Message archive**, select the channel, and refresh or reselect to fetch it. The website does not live-push new messages. Statistics shows daily/hourly counts and categories; Media & stickers shows available attachment/sticker metadata and optional external Discord links for the selected authorized channel. These are not transcripts of every server channel. ArchiveMe does not store or download the files; Discord links may expire, and older messages may lack metadata.
4. Edit that test message in Discord. Reload the archive and look for the new text if the bot saw the edit event. Delete it in Discord. Reload again and look for its removal if the bot saw the delete event. Bot downtime can cause gaps or stale saved text.
5. Turn the channel **off**. That stops new collection and hides its existing saved message view, but **does not erase saved rows**. Turning it on again can reveal them. Use **Purge** in Channel settings only for this test data if you want to remove saved messages; the original Discord messages and earlier backups are separate.

If the archive search box does not find your text, first press **Load more** if available. Search only checks the pages already loaded in your browser. A missing result is not proof the bot never saved a message.

## 6. Keep people and data safe

**Opt-in is a technical switch, not a privacy agreement.** Before using real community messages, tell members which channels would be archived, when capture starts, what is stored, who can see it, how long data and backups last, and whom to contact about deletion. Determine the right consent or other legal basis for your community and location. Do not enable a sensitive or unsuspecting channel. Review the current [Discord Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy), [Developer Terms](https://support-dev.discord.com/hc/en-us/articles/8563935748247-Discord-Developer-Terms-of-Service), and applicable privacy law before any real rollout. This guide does not certify compliance or provide legal advice.

Keep the bot token and OAuth client secret in the server's private environment, never in browser files. If a secret leaks, **reset it in Discord's Portal** and update your private configuration. Do not post `.env`, `data/`, archived content, login links with codes, or browser cookies in public issues. Use fictional data for public screenshots.

Choose the least permissions needed. Do not give the bot Administrator. Even the manager dashboard requires current channel access. The app checks protected requests, but a person can still keep screenshots or content already loaded in a browser. The host operator and anyone with database or backup access also need careful restrictions.

Default live-message retention is **90 days**, with cleanup at startup and hourly while running. Disabling is not deletion. Purging affects the live archive, **not** Discord messages or old backup files. An observed Discord deletion removes a saved row; a missed event can leave one behind. There is no automatic backup or full deletion-request system. Decide how to secure and expire any backups before collecting real messages.

## 7. Optional hosting and website changes

**Hosting is optional.** Everything above can stay on your own computer. At present this repository does not provide a public hosted ArchiveMe site. Its local `localhost` address works only on that computer; adding a bot to a different server does not make the website public.

If you later host it for a real community, pause first for the privacy and policy review above. You would need one reliably running Node process, a private **persistent** disk for SQLite, a private secret store, backups that you can restore, a domain, HTTPS, and monitoring. Production mode requires an HTTPS `BASE_URL` and all three Discord credentials. Register the matching `https://your-domain.example/auth/callback` redirect in Discord. Keep the Node port private behind a properly configured HTTPS reverse proxy. `/ready`, not just `/health`, tells you whether the Discord bot and its initial sync are ready. A cheap host that forgets its disk on restart will lose the archive. The [technical reference's deployment section](TECHNICAL_REFERENCE.md#14-deployment-tls-persistence-and-operations) explains the harder steps. **Do not treat that example as a deployed service.**

Want to change colors, text, layout, or buttons? Follow [Redesigning ArchiveMe's website](REDESIGN_WEBSITE.md). Website words and structure live in `web/src/main.jsx`; styles live in `web/src/styles.css`. After a design change, run `npm --prefix web run build`, refresh the browser page, and check the sign-in page and authorized test-server views. A redesign must not remove permission checks, the attachment/sticker metadata-only limitation, or the install/login distinction.

## 8. Troubleshooting and small glossary

| What happened? | First thing to check |
| --- | --- |
| `node` is missing or too old | Install supported [Node.js](https://nodejs.org/en/download). Run `node --version` again. |
| The page says “Frontend not built” | From the ArchiveMe folder, run `npm --prefix web ci` and `npm --prefix web run build`, then refresh. |
| `/ready` says unavailable | Expected before a bot is connected. For live mode, check bot startup logs, token, Message Content intent, and network access. |
| **Add bot to your server** is absent | The link appears only with a valid application ID **and** a ready, synchronized bot. You can use the Portal's installation flow for initial setup. |
| Discord sign-in fails | Check that `BASE_URL` is `http://localhost:3000`, that the Portal redirect is exactly `http://localhost:3000/auth/callback`, and that the app ID and secret match. Retry login rather than reusing an old callback URL. |
| Signed in, but no server or channel appears | Check bot installation, manager's Manage Server permission, and **both** person's and bot's channel permissions. Refresh after changing them. |
| No new messages appear | Check the channel was enabled **before** posting, bot is connected, message is from a person in an ordinary server text channel, and Message Content intent is available. Reload the archive. |
| A change says “Access denied” | Do not grant Administrator as a shortcut. Recheck current server and channel permissions. |

**Glossary:** A **server** (called a *guild* in Discord's API) contains channels. A **bot** is a separate Discord account run by your app; its **token** is its secret password-like key. A **Discord application** is the Portal setup that owns that bot and the website's OAuth2 login credentials. **Install/invite** adds the bot to a server; **login** identifies a person to the website. **Opt-in** means explicitly enabling an individual channel; by default none are enabled. A **database** is where this app saves its records, in a local SQLite file. An **API** is how the website asks the server for allowed data. A **terminal** is the command window used to start the app. **Purge** deletes a channel's saved messages from the live database; it is not the same as turning collection off.

For the deeper explanation of authentication, permissions, storage, testing, backups, and deployment, return to the [full technical reference](TECHNICAL_REFERENCE.md). You can learn those pieces one at a time, after the consenting test-server exercise works.
