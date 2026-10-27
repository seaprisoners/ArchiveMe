# Redesigning ArchiveMe's website: a simple beginner recipe

You can change the entire appearance without touching Discord credentials, the bot, the database, or server permissions. The website is a React interface in `web/`. Its structure and words are in [`web/src/main.jsx`](../web/src/main.jsx); its colors, sizes, spacing, and layout are in [`web/src/styles.css`](../web/src/styles.css). The browser entry page (title, description, optional fonts) is [`web/index.html`](../web/index.html). The Express backend serves the compiled version from ignored `web/dist/`; **edit the source files, not `web/dist/`**.

## Five safe steps

1. **Save your current version.** From the ArchiveMe directory, run `git status --short`. Once your changes are ready, make a normal commit so you can return to this look later. Your GitHub repo is [seaprisoners/ArchiveMe](https://github.com/seaprisoners/ArchiveMe), but editing files locally does *not* automatically update GitHub.
2. **Pick a design direction.** Write down three choices: primary color, background color, and mood (for example, warm/minimal or bold/dark). Sketch where the bot intro, login, and dashboard navigation should go. Use fictional messages when making public screenshots.
3. **Change the look in [`web/src/styles.css`](../web/src/styles.css).** Search for `.login-` to change the front page, `.sidebar` and `.topbar` to change navigation, `.stat-card` and `.chart-` for graphs, `.archive-` and `.message` for the message page, and `.settings-` for admin controls. The CSS currently has long, compact lines: turn a section into readable multi-line rules if you want; formatting alone does not change behavior. Colors are mostly direct hex values such as `#6563d6`. Start with a few changes, rebuild, and compare. Do not forget the `@media(...)` rules near the end, which control smaller screens.
4. **Change sections or words in [`web/src/main.jsx`](../web/src/main.jsx).** `Login` is the front page; `WelcomeVisual` is the decorative illustration; `Sidebar` is navigation; `Overview` contains the analytics cards; `Archive` renders messages; `Settings` contains channel controls. You can rearrange elements inside those components. Keep React text rendering for message contents—**never** inject message text as HTML. Keep the login, channel permissions, settings, purge confirmation, synthetic-demo labeling, and the bot-install safety note working. The bot-install button is shown only when `/api/public-config` reports a configured, connected bot. Installation is not website login and is not permission to archive anything.
5. **Build and test.** Run `npm --prefix web run build` and `npm test` from the project root. Then open **http://localhost:3000/** and *refresh the page*; the existing Express server serves the newly built assets, so no second server is needed. Check both the signed-out front page and the synthetic demo, plus mobile width in your browser's responsive design tools. When happy, run `git diff --check`, review `git diff`, then commit and push only the intended source files—never `.env`, `data/`, or `web/dist/`.

### Tiny practice example

Want square instead of rounded buttons? In [`web/src/styles.css`](../web/src/styles.css), find `.primary-button,.secondary-button` and change `border-radius:11px` to `border-radius:4px`. Run:

```sh
npm --prefix web run build
npm test
```

Refresh the front page. If you dislike it, change the value back. This is a safe way to learn CSS: **make one visible change, rebuild, inspect, repeat**.

### If you want to redesign everything

Start with the sign-in page, then the sidebar, then a shared card/button style, then the charts and archive. Maintain consistent fonts, spacing, focus outlines, adequate contrast, and a mobile layout. Aim for an original archive identity rather than copying Discord's exact branding. Do not put Discord bot tokens or client secrets in `web/` or in screenshots: browser code is public. Never remove server-side permission checks to make a design work; the backend must remain the source of truth. For background on JSX and CSS, see the official [React Learn guide](https://react.dev/learn) and [MDN CSS introduction](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Styling_basics/What_is_CSS).
