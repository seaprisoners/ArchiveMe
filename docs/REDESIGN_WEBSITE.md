# Redesign the website (beginner-friendly)

Start with **[`web/src/styles.css`](../web/src/styles.css)**. This is the source stylesheet: its rules control layout, colors, spacing, forms, and buttons. The existing page structure and words live in [`web/src/main.jsx`](../web/src/main.jsx), but you do **not** need to change JavaScript or backend code to change the look. Do not edit generated `web/dist/` files; the next build replaces them.

The stylesheet is intentionally a plain starting point: no imported font, gradient, shadow, animation, or decorative brand theme. It retains basic spacing, responsive navigation, readable controls, and visible keyboard focus. You can redesign it gradually while keeping those basics.

## Make one safe change

1. Open [`web/src/styles.css`](../web/src/styles.css) in a text editor. The first `:root` block is your color-and-spacing control panel. For example, change `--accent: #184c82;` to `--accent: #17603d;` to change the main action button and active toggle. Or change `--space: 1rem;` to `--space: 1.25rem;` for more breathing room. Check text against its background for sufficient contrast; if you change `--accent`, check `--accent-text` too.
2. To change just one part of the site, find its CSS selector. Examples: `.login-panel` controls front-page padding; `.sidebar` controls dashboard navigation width; `.primary-button` controls the main button; `.message` controls archive row layout; `.statistics-filters` controls filters on Statistics and Media & stickers pages; `.hourly-chart` and `.category-chart` contain the labeled chart rows; `.hour-bar` and `.category-bar` lay out each label, visible progress bar, and number; `.media-item` controls a media listing, and `.media-preview` sizes any available thumbnail. A CSS selector is the name before `{`; properties inside the braces are the values you can change. For example:

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

You can eventually edit [`web/src/main.jsx`](../web/src/main.jsx) to rearrange markup, but never insert untrusted archived text as raw HTML or remove permission checks. In **Statistics**, “Most active hours” counts archived messages per UTC hour for the selected channel and period. “What messages contain” gives each message **one** category: a video attachment takes priority over an image attachment, then a URL in the text, then any other nonempty text; anything else (including sticker-only messages and attachments without a recognized image/video type) goes in Other. An older record without media classification goes in Older / unclassified: it is **not** assumed to be text or to contain no media. The chart bars show relative counts; labels and numbers remain available even if the bars are not visible.

The **Media & stickers** view lists attachment and sticker details, available Discord-hosted links, and metadata for recognized emojis from messages collected after emoji capture was added. Popular sticker and emoji counts are metadata counts, not copies of their files. When a safe Discord-hosted image URL is available, the browser can show a small sticker/image/custom-emoji thumbnail directly from Discord; a missing or expired link should still leave readable names and counts. ArchiveMe does **not** fetch, store, serve, or download the binary media files on its own server; viewing a thumbnail requests it from Discord, while choosing an external link opens Discord. Only approved Discord media hosts should be used for thumbnails and links. Discord may remove or expire them. **Messages saved before media or emoji metadata collection may have no such details.** Adding other preview sources or local downloads needs separate privacy, authorization, and storage review. The bot-install link is distinct from human sign-in and does not enable channel archiving.

For CSS fundamentals, see [MDN's CSS introduction](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Styling_basics/What_is_CSS). For JSX and components, see [React Learn](https://react.dev/learn).
