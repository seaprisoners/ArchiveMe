# Redesign the website (beginner-friendly)

Start with **[`web/src/styles.css`](../web/src/styles.css)**. This is the source stylesheet: its rules control layout, colors, spacing, forms, and buttons. The existing page structure and words live in [`web/src/main.jsx`](../web/src/main.jsx), but you do **not** need to change JavaScript or backend code to change the look. Do not edit generated `web/dist/` files; the next build replaces them.

The stylesheet is intentionally a plain starting point: no imported font, gradient, shadow, animation, or decorative brand theme. It retains basic spacing, responsive navigation, readable controls, and visible keyboard focus. You can redesign it gradually while keeping those basics.

## Make one safe change

1. Open [`web/src/styles.css`](../web/src/styles.css) in a text editor. The first `:root` block is your color-and-spacing control panel. For example, change `--accent: #184c82;` to `--accent: #17603d;` to change the main action button and active toggle. Or change `--space: 1rem;` to `--space: 1.25rem;` for more breathing room. Check text against its background for sufficient contrast; if you change `--accent`, check `--accent-text` too.
2. To change just one part of the site, find its CSS selector. Examples: `.login-panel` controls front-page padding; `.sidebar` controls dashboard navigation width; `.primary-button` controls the main button; `.message` controls archive row layout; `.statistics-filters` controls filters on Statistics and Media & stickers pages; `.media-item` controls a metadata listing. A CSS selector is the name before `{`; properties inside the braces are the values you can change. For example:

   ```css
   .primary-button {
     background: var(--accent);
     border-color: var(--accent);
     color: var(--accent-text);
   }
   ```

3. In a terminal **at the project root**, build the website:

   ```sh
   npm --prefix web run build
   ```

4. Refresh the **existing** ArchiveMe page served by the running Express app (normally `http://localhost:3000/`). A build changes the served assets; you do not need to start a second web server. For frontend changes, a browser refresh is required. Inspect the sign-in page and, after signing in as an authorized manager, Overview, Message archive, Statistics, Media & stickers, and Channel settings. At narrow mobile widths, check that the menu opens, forms remain usable, and text does not overflow. Use your own consenting test server with invented messages; there is **no synthetic preview button**.
5. Repeat one change at a time. If something breaks, undo that change; run `git diff --check` to catch whitespace errors and `git diff -- web/src/styles.css` to review exactly what changed. Before committing, run `npm test` too. Keep `.env`, `data/`, and `web/dist/` out of commits.

You can eventually edit [`web/src/main.jsx`](../web/src/main.jsx) to rearrange markup, but never insert untrusted archived text as raw HTML or remove permission checks. The Statistics and Media & stickers tabs display aggregate counts and **attachment/sticker metadata only** (such as names, file types, sizes, and Discord-hosted links when available). ArchiveMe does **not** fetch, store, serve, or download attachment/sticker binary files; a user choosing an external Discord link leaves the app and Discord may no longer host that file. **Messages saved before metadata collection may have none.** Do not add in-app binary previews/downloads without separate privacy, authorization, and storage review. The bot-install link is distinct from human sign-in and does not enable channel archiving.

For CSS fundamentals, see [MDN's CSS introduction](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Styling_basics/What_is_CSS). For JSX and components, see [React Learn](https://react.dev/learn).
