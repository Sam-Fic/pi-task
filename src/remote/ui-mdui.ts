/** Stage 0 — Minimal Viable mdui webui.
 * Loads the pre-bundled mdui.esm.js (single file, 358 KB) which contains
 * tslib, lit, all components and all helper functions — it does NOT use
 * the per-component paths under /components/*.js because those have bare
 * `import 'tslib'`/`import 'lit'` specifiers the browser can't resolve.
 *
 * What works:
 *  - WS connect / reconnect (no animation yet)
 *  - Plain chat bubbles (no Markdown / thinking / tools yet)
 *  - agent_running / connected indicator + token counter
 *  - Send while idle, click-to-stop while running (no two-tap arm yet)
 *  - mdui light / dark / auto theme switcher
 *
 * Subsequent stages add: Markdown, thinking <details>, tool cards,
 * prompt card (3 modes + manual), push notifications, scan-to-connect,
 * command autocomplete, reconnect animation, jump-to-bottom button.
 */

// Stage 1-3: import upstream's reusable render helpers. They emit the
// top-level functions (renderMarkdown, syntaxHighlight, toolSummary,
// toolBadge, toolDiffHtml, escHtml) as a JS string we splice into our
// <script> tag. Reusing them keeps the heavy lifting — fence parsing,
// inline formatting, tool summaries, diffs — in upstream-tested code.
import {renderModule} from './ui-render.js'
import {highlightModule} from './ui-highlight.js'
import {toolsModule} from './ui-tools.js'

const M3E_VERSION = '2.7.9'

// @mdui/icons 1.x — used only for the named Material glyphs that mdui
// itself does not register as <mdui-icon-*> web components. Stage 0
// renders icons via <mdui-icon name="..."> which mdui 2.x ships natively.
// @mdui/icons 1.x path kept for future stages that need per-icon components.
// Stage 0 uses mdui-icon name="..." which is resolved by mdui 2.x internally.
// const ICON_BASE = `https://unpkg.com/@mdui/icons@1.0.4`

// Every @m3e/web module is loaded LAZILY (see the import block in stage0Logic).
// Nothing third-party is imported statically here on purpose: a static import
// whose module cannot be fetched or whose export does not exist is a module
// INSTANTIATION error, so the whole client script never runs and the page comes
// up blank — which is exactly what `import { snackbar }` did (that subpath
// exports `M3eSnackbar`, not `snackbar`). One lazy import per component keeps a
// CDN hiccup or a renamed export to one broken control, not a dead UI.
const BUNDLE_IMPORTS = ''

// Stage 0 doesn't import any @mdui/icons — we use mdui-icon name= lookups,
// which work out of the box once the bundle is loaded.
const ICON_IMPORTS = ''

const CSS = `
/* ── Material 3 Expressive accents (on top of mdui 2.x, which is plain M3) ──
   Spring motion tokens, shape morphing, wavy progress. Motion respects
   prefers-reduced-motion. */
:root {
    --m3e-spring-fast: linear(0, 0.0134 1.85%, 0.0487 3.7%, 0.1664 7.4%, 0.5724 12.4%, 0.8029 15.9%, 0.9432 19.7%, 1.0292 23.8%, 1.0834 28.4%, 1.1068 32.8%, 1.1121 37.2%, 1.101 41.6%, 1.083 46%, 1.0605 50.9%, 1.0229 58.5%, 1.0039 66.2%, 0.9985 74%, 1.0011 84.6%, 1);
    --m3e-spring-spatial: linear(0, 0.0062 0.9%, 0.025 1.9%, 0.1 4.1%, 0.4174 8.7%, 0.6829 12.5%, 0.8764 16.4%, 0.9841 20.4%, 1.0665 24.6%, 1.1161 29.1%, 1.1349 33.9%, 1.1353 38.4%, 1.1266 42.9%, 1.1049 48%, 1.0581 55.5%, 1.0254 62.4%, 1.0072 70.1%, 0.9997 79.5%, 1 100%);
}
/* M3 Expressive press (shape morph) is native to the m3e buttons.
   Only the send button needs our own transform spring for the
   send<->stop 90deg swing. */
m3e-icon-button#send-btn {
    /* Capsule, as tall as the input it sits beside. align-self:stretch makes
       the button track the <m3e-form-field> host height exactly, and it keeps
       tracking when the textarea goes multiline. The host is 4px taller than
       the field's VISIBLE box (that 4px is the collapsed supporting-text row's
       leftover margin, see the m3e-form-field rule below), so
       margin-bottom:0.25rem trims the button by exactly that much and its top
       and bottom edges land flush on the visible input box. Width is wider than
       the height so the full-radius shape reads as a stadium, not a circle. */
    width: 5.25rem;
    align-self: stretch;
    margin-bottom: 0.25rem;
    --m3e-icon-button-container-height: 100%;
}
m3e-icon-button#send-btn:active {
    transform: scale(0.94);
}
/* Running swings the GLYPH 90deg, not the button — a rotated capsule
   stands on end (84px tall), which breaks the input-height match. The
   component's ::slotted transform var keeps the spring swing. */
m3e-icon-button#send-btn.running,
m3e-icon-button#send-btn.armed {
    --_icon-button-icon-transform: rotate(90deg);
}

/* mdui 2.x does not load the Material Icons font itself — without this,
   icon="..." attributes render as raw ligature text ("send", "close"...).
   Load it from the same CDN as the mdui bundle so offline/LAN usage
   never depends on Google Fonts. */
@font-face {
    font-family: 'Material Icons';
    font-style: normal;
    font-weight: 400;
    src: url(https://cdn.jsdelivr.net/npm/material-icons@1.13.12/iconfont/material-icons.woff2) format('woff2');
}
:root {
    color-scheme: light dark;
    --chat-max-width: 920px;
    /* One deliberate face: the platform monospace for code blocks and
       terminal-style output. Everything else sets no font-family at all
       and rides the browser's system default. */
    --font-mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
    /* Dynamic M3 color tokens (--md-sys-color-*) are generated by <m3e-theme>
       (wrapping <body>) from its seed color for both light and dark — no manual
       bridge needed. Every m3e component and the layout CSS below read these
       tokens directly. */
}
html, body {
    height: 100%;
    margin: 0;
    overflow: hidden;
    /* <m3e-theme> publishes --md-sys-color-* on ITSELF (#app-theme), a
       DESCENDANT of body — so html/body can never resolve them. The Canvas/
       CanvasText system colors (which honour color-scheme) are the fallback
       that keeps the page from flashing white behind #root; the real themed
       base lives on #root (see below). */
    background: var(--md-sys-color-surface, Canvas);
    color: var(--md-sys-color-on-surface, CanvasText);
    font-family: system-ui, sans-serif;
    /* deliberately no color: see #app-theme below */
    /* Suppress the WebKit/Blink mobile tap flash on every tapped surface —
       the property inherits, so one declaration here (rather than per
       component) covers light DOM, slotted content and shadow trees alike.
       Press feedback is already provided by each component's state layer. */
    -webkit-tap-highlight-color: transparent;
}
/* The real themed base. <m3e-theme> publishes --md-sys-color-* on ITSELF, so
   this is the highest element that can actually resolve them, and the only
   anchor that reaches everything: #root covers the app shell, but the overlay
   panels (#settings-panel, #notif-panel, #prompt-card, #reconnect-overlay) are
   direct children of #app-theme — siblings of #root, not descendants — so they
   never picked up #root's colour. Anchoring here means anything that doesn't
   set its own colour follows the theme instead of falling back to the initial
   black (invisible on the dark surface) or to CanvasText (which tracks the
   BROWSER's scheme, not the app's, and so can be the exact opposite). */
#app-theme { color: var(--md-sys-color-on-surface); }
/* Native scrollbars are hidden app-wide — scrolling surfaces get the
   custom .scroll-thumb overlay instead (see attachScrollbar in the client:
   fades in while scrolling, idles out, draggable). */
* {
    scrollbar-width: none;
}
*::-webkit-scrollbar { width: 0; height: 0; display: none; }
.scroll-thumb {
    position: absolute;
    width: 5px;
    /* Half the width — the round cap. On the rounded command panel the thumb
       is TRANSLATED so these caps' centers land exactly on the card corner
       arcs' centers (see attachScrollbar's rightInset/inset): with a 28px
       corner, both sit 28 - 2.5 = 25.5px from the edges. */
    border-radius: 2.5px;
    background: color-mix(in srgb, var(--md-sys-color-on-surface-variant) 55%, transparent);
    opacity: 0;
    transition: opacity 250ms;
    pointer-events: auto;
    cursor: default;
    z-index: 6;
}
.scroll-thumb.on { opacity: 1; }
.scroll-thumb.dragging { background: color-mix(in srgb, var(--md-sys-color-on-surface-variant) 80%, transparent); }
#root {
    display: grid;
    /* One child: the session drawer wraps the whole main column. */
    grid-template-rows: minmax(0, 1fr);
    height: var(--app-height, 100dvh);
    /* #root is the outermost element INSIDE <m3e-theme>, so this is where the
       generated tokens are first resolvable. Anchor the base surface and text
       color here — every descendant that doesn't set its own colour inherits
       these adaptive values. Without it they fall back to the initial black,
       which is invisible on the dark surface (e.g. the settings-card labels). */
    background: var(--md-sys-color-surface);
    color: var(--md-sys-color-on-surface);
}

/* Session sidebar. m3e-drawer-container overlays the drawer (over-mode, with
   scrim) on the main column; #main-col takes over #root's old rows so the
   app-bar/chat/bands layout is untouched. The drawer's .content pane is
   height:100%, but the slotted column must CLAIM that height — otherwise it
   sizes to content, the whole page scrolls, and the composer ends up at the
   bottom of the document instead of the viewport. */
#main-col {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto auto auto;
    height: 100%;
    min-height: 0;
    /* Without min-width:0 the grid column adopts the input bar's min-content
       (~394px, set by the textarea's default cols), forcing horizontal
       overflow on narrow phones even though the field itself can shrink. */
    min-width: 0;
}
#drawer { --m3e-drawer-container-width: min(84vw, 20rem); }
#session-drawer {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: calc(var(--safe-top) + 0.5rem) 0.5rem 0.75rem;
    box-sizing: border-box;
    height: 100%;
}
#session-drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 0.5rem;
}
#session-drawer-title { font-size: 0.95rem; font-weight: 600; }
#session-list { flex: 1; min-height: 0; overflow-y: auto; }
#session-list m3e-nav-menu-item {
    /* Two-line rows: the default fixed height would clip the subtitle. */
    --m3e-nav-menu-item-height: auto;
}
#session-list .s-label {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
    padding-block: 0.375rem;
}
#session-list .s-title {
    font-size: 0.875rem;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
}
#session-list .s-sub { font-size: 0.72rem; color: var(--md-sys-color-on-surface-variant); }
#session-list .s-empty {
    padding: 1.25rem 1rem;
    font-size: 0.85rem;
    color: var(--md-sys-color-on-surface-variant);
    text-align: center;
}

/* Content of the bottom bands aligns with the centered chat column
   without extra wrappers: at least 1rem, else centered-column + 1rem. */
:root {
    --col-pad: max(1rem, calc((100vw - var(--chat-max-width)) / 2 + 1rem));
}
/* Notch/home-bar insets (viewport-fit=cover): with a single merged app bar
   nobody else compensates for the status bar, and the composer must clear
   the home indicator. Zero in normal browsers. */
:root {
    --safe-top: env(safe-area-inset-top, 0px);
    --safe-bottom: env(safe-area-inset-bottom, 0px);
}
/* The app bar stays a quiet neutral band — the expressive accents live in
   the composer, avatars and the task panel instead. */
/* The bar's height, surface and padding are owned by <m3e-app-bar> now. These
   three slotted clusters just lay out their own content; M3E's template slots
   them into leading / title / trailing. */
#app-bar { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }
#app-title { display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
#app-actions { display: flex; align-items: center; gap: 0.4rem; flex-shrink: 0; }
/* The model name takes the old title slot; falls back to the app name
   (muted) before the first snapshot reports a model. The pill is the
   activation surface: an m3e-menu-trigger nested inside augments it with
   the menu relationship and opens #model-menu; a tonal background
   (hierarchy by color, never a hairline stroke) whose caret flips while
   the menu is open. */
#model-picker {
    display: flex;
    align-items: center;
    gap: 0.7rem;
    /* Shrink-to-fit so the name isn't starved by the .grow spacer; long
       names still ellipsize when the row genuinely runs out of room. */
    flex: 0 1 auto;
    min-width: 0;
    padding: 0.2rem 0.7rem 0.2rem 0.65rem;
    border-radius: 999px;
    cursor: pointer;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    background: color-mix(in srgb, var(--md-sys-color-on-surface) 7%, transparent);
    transition: background 200ms;
}
/* The trigger is a pure behavior wrapper: dissolve its box so the name and
   caret participate directly in the pill's flex layout. */
#model-picker m3e-menu-trigger { display: contents; }
#model-picker:hover {
    background: color-mix(in srgb, var(--md-sys-color-on-surface) 13%, transparent);
}
#model-picker.open {
    background: var(--md-sys-color-secondary-container);
}
#status-model {
    /* Information, not a wordmark: the model name in the platform's UI font
       (the old rounded display face was leftover title styling). */
    font-size: 1.05rem;
    font-weight: 650;
    letter-spacing: 0.01em;
    line-height: 1.4;
    color: var(--md-sys-color-on-surface);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
#model-picker.open #status-model {
    color: var(--md-sys-color-on-secondary-container);
}
#model-caret {
    /* Same pure-CSS chevron as the thinking/tool headers (see --_chev-shift
       there): an L of side s and stroke t, centroid pulled back 0.25*(s-t)
       so the visual mass rides the flex centerline. Closed points down,
       open flips 180deg up — same spring as the card chevrons. */
    --_chev-shift: calc((0.4rem - 1.5px) / -4);
    width: 0.4rem; height: 0.4rem;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: rotate(45deg) translate(var(--_chev-shift), var(--_chev-shift));
    transition: transform 350ms var(--m3e-spring-fast);
    flex-shrink: 0;
    color: var(--md-sys-color-on-surface-variant);
}
#model-picker.open #model-caret {
    transform: rotate(-135deg) translate(var(--_chev-shift), var(--_chev-shift));
    color: var(--md-sys-color-on-secondary-container);
}
#status-model.fallback {
    color: var(--md-sys-color-on-surface-variant);
    font-weight: 550;
}
#status-ctx {
    font-size: 0.78rem;
    color: var(--md-sys-color-on-surface-variant);
    white-space: nowrap;
    flex-shrink: 0;
}
/* Narrow phones: the context figures duplicate the ctx-bar below, so the
   text yields its space to the model name. */
@media (max-width: 420px) {
    #status-ctx { display: none; }
}
/* App-bar icon pair reads at on-surface (brighter than the icon-button
   default). */
#notif-btn,
#settings-btn {
    --md-sys-color-on-surface-variant: var(--md-sys-color-on-surface);
}
#notif-btn { flex-shrink: 0; }
/* The bell lights up while push notifications are enabled — passive,
   glanceable, no tooltip needed. */
#notif-btn.on { --md-sys-color-on-surface-variant: var(--md-sys-color-primary); }
/* Status readout, not an action: a plain pill instead of mdui-chip, whose
   button internals bring ripple/press affordances a passive indicator
   must not have. Neutral tonal pill against the color field. */
#status-chip {
    padding: 0.3rem 0.85rem;
    border-radius: 999px;
    background-color: var(--md-sys-color-surface-container-highest);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.8rem;
    line-height: 1.2;
    flex-shrink: 0;
    user-select: none;
}
#status-dot {
    width: 0.5rem; height: 0.5rem; border-radius: 50%;
    background: var(--md-sys-color-outline);
    transition: background 0.2s;
    flex-shrink: 0;
}
#status-dot.connected.idle    { background: var(--md-sys-color-tertiary); }
#status-dot.connected.running { background: var(--md-sys-color-primary);
    animation: pulse 1.4s ease-in-out infinite; }
#status-dot.disconnected      { background: var(--md-sys-color-error); }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
/* Context-window usage as the same M3 Expressive wavy indicator the task
   widget uses. Track sits one tonal step above the bar; the wave turns
   error-red once usage runs hot (the old gradient's danger signal). */
#ctx-stack {
    position: absolute;
    /* Sits in the band just below M3E's small app-bar (whose host is 64px =
       4rem). Below the bar's z-index (30), so it must clear its full height
       or the bar would paint over the wave. */
    top: calc(var(--safe-top) + 4rem);
    left: 0; right: 0;
    height: 0.5rem;
    display: block;
    width: 100%;
    z-index: 29;
    --md-sys-color-primary: var(--md-sys-color-primary);
    --md-sys-color-secondary-container: var(--md-sys-color-surface-container-highest);
}
#ctx-stack.hot { --md-sys-color-primary: var(--md-sys-color-error); }
#ctx-stack m3e-linear-progress-indicator { display: block; width: 100%; }
/* The indicator is a custom element from a SECOND CDN (mdui itself comes
   from jsdelivr). Until it is defined the tag is unknown: zero height, so
   the bar is simply absent, and every value write lands on a plain
   HTMLElement as a no-op — a failure that is completely silent. This
   CSS-only bar is the floor: paintCtx() drives its fill width directly,
   with no library at all, and it is retired only once the element really
   upgrades (see customElements.whenDefined below). */
#ctx-fallback {
    display: block;
    height: 4px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--md-sys-color-surface-container-highest);
}
#ctx-fallback > i {
    display: block;
    height: 100%;
    width: 0;
    border-radius: inherit;
    background: var(--md-sys-color-primary);
    transition: width 300ms;
}
#ctx-stack.hot #ctx-fallback > i { background: var(--md-sys-color-error); }
#ctx-stack.m3e #ctx-fallback { display: none; }
/* The wavy layer lives on top; the two layers crossfade exclusively so
   the flat fill never lingers under the rolling wave. */
#ctx-bar {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 300ms;
}
#ctx-bar-flat { transition: opacity 300ms; }
#ctx-stack.live #ctx-bar { opacity: 1; }
#ctx-stack.live #ctx-bar-flat { opacity: 0; }
/* The top-app-bar is absolutely positioned inside this wrapper (its
   scroll-target mode requires a relative, overflow-hidden parent) and the
   chat scrolls beneath it. */
#chat-wrap { position: relative; min-height: 0; display: flex; overflow: hidden; }
#chat-log { flex: 1; min-width: 0; overflow-y: auto; overflow-x: hidden;
    padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem;
    /* Own the top inset: full bar height (M3E small app-bar = 64px) plus the
       10px wave band plus air, so the first message never tucks under the
       bar. !important beats the component's own inline padding-top. */
    padding-top: calc(var(--safe-top) + 4rem + 10px + 0.5rem) !important; }
/* The bar paints neutral (matching the #app-bar row); it also must clear
   the notch. m3e tokens are full color values — reference --md-sys-color-*
   directly, never rgb()-wrapped, and never self-referentially (a var
   citing itself turns guaranteed-invalid down the whole subtree, which is
   how the app-bar icons once ended up at 1.7:1 contrast). */
m3e-app-bar#top-bar {
    --md-sys-color-surface: var(--md-sys-color-surface-container);
    /* Pinned to the top of the scroll-wrap; the chat clears it via
       #chat-log's padding-top. z above the chat and the ctx wave. */
    position: absolute; top: 0; left: 0; right: 0; z-index: 30;
    width: 100%;
    /* The small variant hardcodes a 64px host with 12px padding, which
       double-centers our 52px row and pushes the context wave outside the
       bar. Our row owns its spacing — the component just wraps it. */
    padding: 0;
    height: auto;
}
/* Children must keep their natural height: overflow-hidden collapse wrappers
   would otherwise be flex-shrunk to a squashed strip instead of scrolling. */
#chat-log > * { flex-shrink: 0; }
.msg {
    max-width: var(--chat-max-width); width: 100%; margin: 0 auto;
    display: flex; gap: 0.75rem;
}
.msg.user { flex-direction: row-reverse; }
.bubble {
    position: relative;
    padding: 0.75rem;
    /* Concentric with the code blocks it wraps: the block's corner arc
       center sits (code-r + pad, code-r + pad) in from the bubble corner.
       The padding is uniform, and a code block at the bubble's top/bottom
       edge gets the same 12px gap as at the sides (its edge margins are
       zeroed below), so the buffered outer corner is a plain 32px circle —
       no elliptical slash pair needed. Prose blocks buy their roomier
       24px side inset below, in their own margins, so the corner math
       stays code-driven. */
    --_code-r: calc(1rem + var(--md-sys-shape-corner-extra-small));
    border-radius: calc(var(--_code-r) + 0.75rem);
    /* Single-line content turns the bubble into a capsule of its big
       corner radius: total height = 2 × radius. min-height is content-box
       (no global border-box here), so it carries the padding subtraction:
       2×(code-r + pad) − 2×pad = 2×code-r. The single-line code block
       (40px) lands exactly on it too. align-content centers short content
       in the extra space; taller content overflows the min-height and
       centering is a no-op. Same rule horizontally: a lone letter must not
       produce a bubble narrower than the arcs can express. */
    min-height: calc(2 * var(--_code-r));
    min-width: calc(2 * var(--_code-r));
    align-content: center;
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface);
    line-height: 1.55;
    max-width: 80%;
    word-wrap: break-word;
}
.msg.user .bubble {
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
    border-top-right-radius: 0.5rem;
    /* Pure-text bubble: no code blocks inside, so the corner math doesn't
       bind — the prose inset comes straight from the padding. */
    padding: 0.75rem 1.5rem;
    /* Roomier 24px sides mean the shared content min-width would land the
       capsule at 88px; subtract it from the 2 × radius TOTAL instead:
       64 − 48 padding = 16px content (2×code-r − 1.5rem), so a lone letter
       still caps at exactly 2 × radius. */
    min-width: calc(2 * var(--_code-r) - 1.5rem);
}
.msg.assistant .bubble {
    /* The one tail corner, pointing at the avatar side. The top-right keeps
       the bubble's concentric elliptical pair — the floating copy circle
       buffers inside that arc (see .bubble-copy). */
    border-top-left-radius: 0.5rem;
}

/* Markdown surface (Stage 1) */
.bubble.md {
    line-height: 1.55;
}
/* Prose buys the roomier 1.5rem/0.875rem inset via its own margins — the
   bubble's padding stays code-block-tight so the concentric corner math is
   untouched. Code blocks (div.code-block and headless pre) are deliberately
   excluded: they keep the tight padded edge the radius buffers around. */
.bubble.md > p, .bubble.md > ul, .bubble.md > ol, .bubble.md > blockquote,
.bubble.md > h1, .bubble.md > h2, .bubble.md > h3,
.bubble.md > h4, .bubble.md > h5, .bubble.md > h6, .bubble.md > table {
    margin-left: 0.75rem; margin-right: 0.75rem;
}
.bubble.md > :first-child { margin-top: 0; }
/* :last-of-type, not :last-child — the floating copy button is appended
   inside the bubble and would otherwise count as the last block, keeping
   the real final block's bottom margin (unequal bubble heights). Zeroing
   covers prose AND edge code blocks: with uniform 0.75rem padding, a code
   block at the top or bottom edge sits 12px from the bubble edge — the
   same gap it gets at the sides. */
.bubble.md > :last-of-type { margin-bottom: 0; }
.bubble.md h1, .bubble.md h2, .bubble.md h3, .bubble.md h4, .bubble.md h5, .bubble.md h6 {
    /* margin-block, not the shorthand: the prose inset (margin-inline from
       the child-selector rule above) must survive this rule. */
    margin-block: 0.8em 0.4em;
    font-weight: 600;
    line-height: 1.25;
}
.bubble.md h1 { font-size: 1.4em; }
.bubble.md h2 { font-size: 1.2em; }
.bubble.md h3 { font-size: 1.05em; }
.bubble.md p  { margin-block: 0.5em; }
.bubble.md ul, .bubble.md ol { margin-block: 0.5em; padding-left: 1.5em; }
.bubble.md li { margin-block: 0.2em; }
.bubble.md blockquote {
    margin-block: 0.6em;
    padding: 0.2em 0.8em;
    border-left: 3px solid var(--md-sys-color-outline-variant);
    color: var(--md-sys-color-on-surface-variant);
}
.bubble.md a { color: var(--md-sys-color-primary); text-decoration: none; }
.bubble.md a:hover { text-decoration: underline; }
.bubble.md strong { font-weight: 600; }
.bubble.md em { font-style: italic; }
.bubble.md code {
    background: var(--md-sys-color-surface-container-highest);
    color: var(--md-sys-color-on-surface);
    padding: 0.1em 0.4em;
    border-radius: 0.25rem;
    font-family: var(--font-mono);
    font-size: 0.9em;
}
/* Code block. The copy button floats as a bare circular icon button over the
   top-right corner instead of a full-width header bar, so the code surface
   stays clean. It used to share a 「lang ⧉」 capsule with the language label;
   that pill read as a capsule-shaped BUTTON on any hover-capable device and is
   gone (the label itself is no longer rendered — see ui-render.ts). The
   concentric radius math below still holds: the head is 2rem tall and sits
   --_pill-inset from the corner, so block radius = button radius (1rem) + inset
   and both arcs share a center. */
.bubble .code-block {
    position: relative;
    font-family: var(--font-mono);
    --_pill-inset: var(--md-sys-shape-corner-extra-small);
    --_code-line: 1.25rem;
    background: var(--md-sys-color-surface-container-lowest);
    /* Same radius the bubble's concentric formula consumes (--_code-r is
       defined on .bubble and inherits here). */
    border-radius: var(--_code-r);
    overflow: hidden;
    margin: 0.6em 0;
    font-size: 0.9em;
    /* Capsule recipe: one code line plus two of these paddings is exactly
       2 × --_code-r, so a single-line block IS a capsule (height = 2 ×
       radius) — and the floating pill (top: --_pill-inset, height 2rem)
       lands at its exact vertical center with concentric arcs, since
       2×(1rem + inset) − 2rem = 2×inset leaves inset as the half-space per
       side. Multi-line blocks grow in whole --_code-line steps past it. */
    padding: calc((2 * var(--_code-r) - var(--_code-line)) / 2) 1em;
    line-height: var(--_code-line);
}
.bubble .code-head {
    position: absolute;
    top: var(--_pill-inset);
    right: var(--_pill-inset);
    height: 2rem;
    box-sizing: border-box;
    z-index: 1;
    display: flex; align-items: center;
    opacity: 0;
    transition: opacity 0.15s;
}
.bubble .code-block:hover .code-head { opacity: 1; }
/* Touch devices have no hover — keep the button faintly visible so it never
   hides entirely (and never covers the code: it is one 2rem circle). */
@media (hover: none) {
    .bubble .code-head { opacity: 0.75; }
}
.bubble .code-block pre {
    margin: 0;
    border-radius: 0;
    /* The shrink lives on the pre, not the inner code: strut and inline
       box then share one font size, so each line box is exactly
       --_code-line and the capsule height stays exact. */
    font-size: 0.85em;
    /* Long lines scroll inside the block (the container's overflow:hidden
       would clip them for good). The header pill stays put: it is a child
       of the non-scrolling container. Same pattern as headless pre/tables. */
    overflow-x: auto;
}
/* Direct child only — a pre inside .code-block keeps its own zero-radius
   rule above and lets the container's clipping own the shape. */
.bubble.md > pre {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: var(--md-sys-color-surface-container-lowest);
    color: var(--md-sys-color-on-surface);
    /* Same capsule recipe as .code-block: line + 2 paddings = 2 × radius. */
    --_code-line: 1.25rem;
    padding: calc((2 * var(--_code-r) - var(--_code-line)) / 2) 1em;
    /* Headless code blocks share the .code-block radius so the bubble's
       concentric corner math covers both kinds. */
    border-radius: var(--_code-r);
    overflow-x: auto;
    margin: 0.6em 0;
    line-height: var(--_code-line);
}
.bubble.md pre code {
    background: transparent; padding: 0;
    font-size: inherit;
}
.bubble.md table {
    border-collapse: collapse;
    margin-block: 0.6em;
    font-size: 0.9em;
    /* A wide table on a narrow (phone) viewport must scroll INSIDE the
       bubble, not stretch past it. display:block turns the table into a
       scrollable box; fit-content keeps narrow tables at their natural
       width so only genuinely wide ones grow into a scroll. (Unbreakable
       tokens — long paths, code spans — are what force the overflow.) */
    display: block;
    width: fit-content;
    max-width: 100%;
    overflow-x: auto;
    border-radius: var(--md-sys-shape-corner-small);
}
.bubble.md th, .bubble.md td {
    border: none;
    border-bottom: 1px solid var(--md-sys-color-outline-variant);
    padding: 0.4em 0.7em;
    text-align: left;
}
.bubble.md tr:last-child td { border-bottom: none; }
.bubble.md th { background: var(--md-sys-color-surface-container); font-weight: 600; }
.bubble.md hr {
    border: 0;
    border-top: 1px solid var(--md-sys-color-outline-variant);
    margin: 1em 0;
}

/* Thinking (Stage 2, m3e-expansion-panel) */
m3e-expansion-panel.thinking {
    display: block;
    max-width: var(--chat-max-width);
    width: 100%;
    /* Vertical spacing comes from #chat-log's flex gap alone — every block
       (bubbles, cards, timestamps) then sits the same distance apart no
       matter the neighbour. Extra margins would stack onto the gap and make
       card-adjacent pairs visibly wider than bubble-to-bubble. */
    margin: 0 auto;
    /* Capsule radius: exactly half the collapsed card's height (one
       0.85rem/1.4 header line + two 0.6rem paddings) — a one-line card is
       a stadium. Taller (open) states keep this same fixed radius; it is
       the shared token the flush header consumes too. */
    --_card-r: calc((0.85rem * 1.4 + 1.2rem) / 2);
    border-radius: var(--_card-r);
    /* The m3e-expansion-header the panel renders internally pins its height
       to --m3e-expansion-header-collapsed-height (default 48px) — ~10px
       taller than this card's one-line header (2 × --_card-r), which pushed
       the collapsed card off the exact-capsule shape (radius < half height).
       Pin it to the card's own metric; the open state too, so the header row
       never pads out. */
    --m3e-expansion-header-collapsed-height: calc(2 * var(--_card-r));
    --m3e-expansion-header-expanded-height: calc(2 * var(--_card-r));
    /* The header/body are FLUSH children of the card (the header's own
       0.85rem padding is the whole inset, and radii match with gap 0) — the
       same inset system the pre-m3e card had. m3e-expansion-header ships its
       own space300 left/right padding and m3e-expansion-panel adds a content
       padding on top, which pushed the text ~24px further in per side. Zero
       them so the app's padding is the only inset. */
    --m3e-expansion-header-padding-left: 0;
    --m3e-expansion-header-padding-right: 0;
    --m3e-expansion-panel-content-padding: 0;
    /* The panel's internal .base paints its own OPAQUE container color, which
       would bury the card background below (this card's secondary tint, the
       tool card's surface-container) — and leave a faint 1px seam where that
       opaque layer meets the app's rounded corner. Let the app's own
       background be the only paint. */
    --m3e-expansion-panel-container-color: transparent;
    /* No elevation: the pre-m3e card was a flat tinted surface. The component
       would otherwise paint an elevation shadow on its square-radius .base,
       which the host clip turns into a faint hairline at the right edge. */
    --m3e-expansion-panel-elevation: none;
    --m3e-expansion-panel-open-elevation: none;
    /* A whisper of secondary tint marks "model reasoning" apart from the
       neutral tool-call cards it sits between — expressive, but the body
       text stays on the mixed (mostly neutral) surface. */
    background: color-mix(in srgb, var(--md-sys-color-secondary-container) 30%, var(--md-sys-color-surface-container));
    overflow: hidden;
}
.thinking .thinking-header {
    display: flex; align-items: center;
    cursor: pointer;
    /* Identical box metrics to .tool-header (same padding, font-size and
       explicit line-height) so both collapsed cards are one height. */
    padding: 0.6rem 0.85rem;
    font-size: 0.85rem;
    line-height: 1.4;
    color: var(--md-sys-color-on-surface-variant);
    font-weight: 500;
    user-select: none;
    /* Flush child of the collapse (through the collapse-item wrapper, so
       "inherit" would resolve against that — set the pair explicitly):
       concentric with gap 0 means equal radii. One radius for both states —
       the card keeps its collapsed stadium shape when expanded. */
    border-radius: var(--_card-r);
}
/* Pure-CSS chevron. An L of side s and stroke t has its centroid
   0.25*(s-t) toward the corner, so the shape is pulled back by that
   amount in its own frame before rotating - the visual mass, not the
   box, lands on the flex centerline. */
.thinking .thinking-header {
    --_chev-shift: calc((0.4rem - 1.5px) / -4);
}
.thinking .thinking-header::before {
    content: '';
    width: 0.4rem; height: 0.4rem;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: rotate(-45deg) translate(var(--_chev-shift), var(--_chev-shift));
    transition: transform 350ms cubic-bezier(0.34, 1.56, 0.64, 1);
    transition: transform 350ms var(--m3e-spring-fast);
    margin-right: 0.55em;
    flex-shrink: 0;
}
m3e-expansion-panel.thinking[open] .thinking-header::before { transform: rotate(45deg) translate(var(--_chev-shift), var(--_chev-shift)); }
/* The live loading indicator sits where the old ✻ glyph was: sized to the
   header's em (the component default is 38px) and tinted with the header ink
   so it reads as part of the row, not an imported foreign object. */
.thinking .thinking-spin {
    flex-shrink: 0;
    margin-right: 0.55em;
    --m3e-loading-indicator-size: 1.1em;
    --m3e-loading-indicator-active-indicator-color: var(--md-sys-color-on-surface-variant);
}
.thinking-body {
    margin: 0;
    padding: 0.5rem 1rem 0.85rem;
    /* Reasoning prose, not code — inherit the system default (explicit
       because the element is a <pre>, whose UA font would win). */
    font-family: inherit;
    font-size: 0.82rem;
    line-height: 1.5;
    color: var(--md-sys-color-on-surface-variant);
    white-space: pre-wrap;
    word-wrap: break-word;
    max-height: 16rem;
    overflow-y: auto;
}

/* Tool-call (Stage 2, m3e-expansion-panel) */
m3e-expansion-panel.tool-call {
    display: block;
    max-width: var(--chat-max-width);
    width: 100%;
    /* Same rule as .thinking: #chat-log's flex gap owns the vertical rhythm.
       Same capsule radius token too — both collapsed cards are identical
       stadiums. */
    margin: 0 auto;
    --_card-r: calc((0.85rem * 1.4 + 1.2rem) / 2);
    border-radius: var(--_card-r);
    /* Same exact-capsule pin as .thinking: the panel's internal
       m3e-expansion-header would otherwise hold the collapsed card at its
       48px default instead of one header line (2 × --_card-r). */
    --m3e-expansion-header-collapsed-height: calc(2 * var(--_card-r));
    --m3e-expansion-header-expanded-height: calc(2 * var(--_card-r));
    /* Same flush-child inset as .thinking — drop the component's own
       header/content horizontal padding so the header's 0.85rem (and the
       diff/result rows' padding) is the only inset. */
    --m3e-expansion-header-padding-left: 0;
    --m3e-expansion-header-padding-right: 0;
    --m3e-expansion-panel-content-padding: 0;
    /* Same as .thinking: let the card's own surface-container paint instead
       of the component's opaque .base layer, and drop the component's
       elevation shadow. */
    --m3e-expansion-panel-container-color: transparent;
    --m3e-expansion-panel-elevation: none;
    --m3e-expansion-panel-open-elevation: none;
    background: var(--md-sys-color-surface-container);
    overflow: hidden;
}
m3e-expansion-panel.tool-call.error {
    background: color-mix(in srgb, var(--md-sys-color-error-container) 35%, var(--md-sys-color-surface-container));
}
.tool-call .tool-header {
    cursor: pointer;
    padding: 0.6rem 0.85rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    line-height: 1.4;
    user-select: none;
    /* Flush child of the collapse — same concentric pair as the thinking
       header (explicit, since the collapse-item wrapper breaks "inherit").
       One radius for both states, matching the thinking card. */
    border-radius: var(--_card-r);
}
.tool-call .tool-header {
    --_chev-shift: calc((0.4rem - 1.5px) / -4);
}
.tool-call .tool-header::before {
    content: '';
    width: 0.4rem; height: 0.4rem;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: rotate(-45deg) translate(var(--_chev-shift), var(--_chev-shift));
    transition: transform 350ms cubic-bezier(0.34, 1.56, 0.64, 1);
    transition: transform 350ms var(--m3e-spring-fast);
    margin-right: 0.1em;
    flex-shrink: 0;
}
m3e-expansion-panel.tool-call[open] .tool-header::before { transform: rotate(45deg) translate(var(--_chev-shift), var(--_chev-shift)); }
.tool-label {
    flex: 1;
    font-size: 0.85rem;
    color: var(--md-sys-color-on-surface);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}
.tool-badge {
    flex-shrink: 0;
    font-size: 0.75rem;
    padding: 0.1rem 0.4rem;
    border-radius: var(--md-sys-shape-corner-extra-small);
    background: var(--md-sys-color-tertiary-container);
    color: var(--md-sys-color-on-tertiary-container);
}
.tool-elapsed {
    flex-shrink: 0;
    font-size: 0.75rem;
    color: var(--md-sys-color-on-surface-variant);
}
/* The result area (result text + diff) is ONE inset, concentric plate rather
   than a full-bleed surface: it floats inside the card with a 0.6rem gap on
   the left/right/bottom and sits flush under the header. Its radius is the
   card radius minus that gap, so the bottom arcs share a centre with the
   card's (the concentric rule). It is empty until a result arrives, hence the
   :empty hide — an empty body would paint a bare 0.6rem strip. */
.tool-body {
    background: var(--md-sys-color-surface-container-lowest);
    /* margin, not padding: padding would leave the background full-bleed and
       only inset the text. The margin insets the whole plate. */
    margin: 0 0.6rem 0.6rem;
    border-radius: calc(var(--_card-r) - 0.6rem);
    overflow: hidden;
}
.tool-body:empty { display: none; }
.tool-diff {
    /* Both children are transparent and share the .tool-body plate. Each one
       carries the SAME roomy padding on all four sides, so the text sits an
       equal 0.75rem from the plate's edges (the plate's top/bottom inset
       comes from the first and last child's own padding). */
    padding: 0.75rem;
    background: transparent;
    font-family: var(--font-mono);
    font-size: 0.82rem;
    line-height: 1.45;
    overflow-x: auto;
    max-height: 14rem;
    overflow-y: auto;
}
.tool-result {
    margin: 0;
    /* Transparent: the shared .tool-body plate carries the surface. Equal,
       roomy padding on all four sides gives the terminal output breathing
       room and matches .tool-diff's inset. */
    padding: 0.75rem;
    background: transparent;
    font-family: var(--font-mono);
    font-size: 0.82rem;
    line-height: 1.45;
    white-space: pre-wrap;
    word-wrap: break-word;
    max-height: 18rem;
    overflow: auto;
    color: var(--md-sys-color-on-surface-variant);
}
.avatar {
    width: 2.25rem; height: 2.25rem;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.15rem; flex-shrink: 0;
}
/* Both avatars are library shapes now: the user gets the M3 arch, pi keeps
   the 4-leaf-clover flower (see makeAvatar). m3e-shape clips its children,
   so each role's tonal surface lives on the inner fill element. */
m3e-shape.avatar { font-size: 1.15rem; }
m3e-shape.avatar .avatar-fill {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    /* π's flower in tertiary-container — the third voice of the expressive
       triad (user = primary arch, composer = filled primary). */
    background: var(--md-sys-color-tertiary-container);
    color: var(--md-sys-color-on-tertiary-container);
}
m3e-shape.avatar .avatar-fill.user {
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
}
m3e-shape.avatar .avatar-fill.error {
    background: var(--md-sys-color-error-container);
    color: var(--md-sys-color-on-error-container);
}
/* Circle fallback while the shape module is still loading. */
m3e-shape.avatar:not(:defined) .avatar-fill { border-radius: 50%; }
#input-bar {
    display: flex; gap: 0.5rem; align-items: flex-end;
    padding: 0.75rem var(--col-pad) calc(var(--safe-bottom) + 1rem);
    background: var(--md-sys-color-surface-container);
    width: 100%;
    box-sizing: border-box;
}
#input { flex: 1; min-width: 0; width: 100%; }
/* The flex child of the bar is the m3e-form-field WRAPPER, not the inner
   #input textarea. The wrapper must grow to fill the row; otherwise it keeps
   its intrinsic width and leaves a gap beside the send button. (#input's own
   flex:1 only governs the textarea inside the wrapper.)
   At the component's default density the visible field is 56px (the height the
   old MDUI text-field had, and what reads as "normal"), but the host is 76px:
   the extra ~20px is the form-field's RESERVED supporting-text row at the
   bottom (16px body-small line-height + 4px margin). That reserved row has no
   part and no height token, so it can't be removed directly — but it's empty
   here (no supporting/error text), so collapsing its line-height to 0 makes the
   host ~60px and lets the stretched send button sit flush with the visible
   field. Density is left at default on purpose: density:-3 had shrunk the
   VISIBLE field to 44px, which looked too short. Scoped to this host only. */
#input-bar > m3e-form-field { flex: 1 1 auto; min-width: 0; --md-sys-typescale-body-small-line-height: 0px; }
/* Expressive send button: a filled primary circle — the composer's one
   loud accent. send<->stop swings 90deg on the spring token; running/armed
   retarget the primary tokens to the error palette (armed is full error). */
m3e-icon-button#send-btn.running {
    --md-sys-color-primary: var(--md-sys-color-error-container);
    --md-sys-color-on-primary: var(--md-sys-color-on-error-container);
}
m3e-icon-button#send-btn.armed {
    --md-sys-color-primary: var(--md-sys-color-error);
    --md-sys-color-on-primary: var(--md-sys-color-on-error);
}
#reconnect-overlay {
    position: fixed; inset: 0;
    /* Scrim is M3-black by design; its text is always white — the only
       non-token pair here, deliberate per the M3 scrim spec. */
    /* m3e-theme emits FULL COLOR VALUES (#rrggbb), not "r, g, b" triplets, so
       rgb(var(--md-sys-color-scrim) / .6) is invalid CSS and silently dropped
       the scrim — leaving the white text floating on the bare surface and
       practically invisible in light mode. color-mix handles hex tokens. */
    background: color-mix(in srgb, var(--md-sys-color-scrim) 60%, transparent);
    color: #fff; font-weight: 500;
    display: none;
    align-items: center; justify-content: center;
    z-index: 200;
}
#reconnect-overlay.show { display: flex; }

/* ───────── Stage 3: held bar, status panel, bell, prompt card, etc. ───────── */
#held-bar {
    display: none;
    align-items: center; gap: 0.5rem;
    padding: 0.5rem var(--col-pad);
    background: var(--md-sys-color-tertiary-container);
    color: var(--md-sys-color-on-tertiary-container);
    width: 100%;
    box-sizing: border-box;
    font-size: 0.85rem;
}
#held-bar #held-label { font-weight: 600; }
#held-bar #held-text {
    flex: 1; font-style: italic;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
m3e-icon-button#held-clear {
    /* The component paints from its own token chain, not host color — match
       the held text it sits next to (the bar is tertiary-container). */
    --md-sys-color-on-surface-variant: var(--md-sys-color-on-tertiary-container);
}

/* Live-task panel as an expressive color block: secondary-container reads
   as "the agent is working now" — the held bar (tertiary) stays distinct. */
m3e-card#status-panel {
    display: none;
    box-sizing: border-box;
    width: 100%;
    padding: 0.6rem var(--col-pad);
    border-radius: 0;
    font-size: 0.85rem;
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
}
#status-panel.structured .widget-title { font-weight: 600; margin-bottom: 0.3rem; }
#status-panel.structured .widget-meta {
    display: flex; gap: 0.6rem; align-items: center;
    color: color-mix(in srgb, var(--md-sys-color-on-secondary-container) 82%, transparent);
    font-size: 0.78rem; margin-bottom: 0.4rem;
}
/* Phase chip matches the app bar's status pill: a stroke-free tonal pill
   (mdui-chip's own look is a hairline-outlined assist chip). On the
   secondary field it goes translucent so the block reads through. */
#status-panel .widget-phase {
    font-size: 0.78rem;
    border: none;
    border-radius: 999px;
    background-color: color-mix(in srgb, var(--md-sys-color-on-secondary-container) 14%, transparent);
    color: var(--md-sys-color-on-secondary-container);
}
/* Wavy determinate indicator — the M3 Expressive signature — rendered by
   @m3e/web's <m3e-linear-progress-indicator variant="wavy"> (loaded from
   esm.sh; mdui 2.x has no Expressive components). Its color tokens are
   scoped here so light/dark follow the same palette; on the secondary
   field the track goes translucent rather than one-tonal-up. */
#status-panel m3e-linear-progress-indicator.widget-bar {
    display: block;
    width: 100%;
    margin: 0.15rem 0 0.3rem;
    --md-sys-color-primary: var(--md-sys-color-on-secondary-container);
    --md-sys-color-secondary-container: color-mix(in srgb, var(--md-sys-color-on-secondary-container) 22%, transparent);
    --md-sys-color-on-surface-variant: var(--md-sys-color-on-secondary-container);
}
@media (prefers-reduced-motion: reduce) {
    m3e-button, m3e-icon-button { transition: none; }
}
#status-panel.structured .widget-action {
    font-family: var(--font-mono); font-size: 0.78rem;
    color: color-mix(in srgb, var(--md-sys-color-on-secondary-container) 82%, transparent);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Bell + notif dropdown. Radius matches the model menu — the three are
   sibling floating panels; its own children (list rows) sit flush and are
   clipped, so no inner radius constrains it. Anchored under its button
   (bar row: 0.5rem pad + 2.5rem settings button + 0.6rem gap). */
#notif-panel {
    position: fixed;
    top: calc(var(--safe-top) + 4rem);
    right: 3.6rem;
    width: min(320px, calc(100vw - 4.6rem)); max-height: 60vh;
    background: var(--md-sys-color-surface-container-high);
    border-radius: var(--md-sys-shape-corner-extra-large);
    box-shadow: 0 4px 8px 3px rgba(0,0,0,.3);
    padding: 0.5rem;
    display: none;
    flex-direction: column; gap: 0.4rem;
    z-index: 60;
    overflow: hidden;
}
#notif-panel.open { display: flex; }
/* Settings dropdown (gear in the app bar): theme mode + thinking auto-
   collapse. Same surface recipe, anchored under its own button. */
#settings-panel {
    position: fixed;
    top: calc(var(--safe-top) + 4rem);
    right: 0.5rem;
    width: min(320px, calc(100vw - 1rem));
    background: var(--md-sys-color-surface-container-high);
    border-radius: var(--md-sys-shape-corner-extra-large);
    box-shadow: 0 4px 8px 3px rgba(0,0,0,.3);
    padding: 0.5rem;
    display: none;
    flex-direction: column; gap: 0.4rem;
    z-index: 60;
    overflow: hidden;
}
#settings-panel.open { display: flex; }
#notif-toggle-row,
#settings-title,
.settings-row,
#thinking-collapse-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.4rem 0.6rem;
    font-size: 0.9rem;
}
.settings-row { gap: 0.5rem; }
#settings-title { font-weight: 600; }
#notif-title { font-weight: 600; font-size: 0.9rem; }

/* Theme-color picker: circular seed-color dots. Each dot shows its literal
   seed — a swatch is the one place a hardcoded color is the content, not
   the chrome. The selection ring re-reads the live primary token, so it
   follows whichever theme is currently applied. */
#accent-list { display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem; }
/* "Extract from image" sits on its own full-width row so the narrow panel's
   overflow:hidden can't clip it beside the seed dots. */
#accent-extract { flex: 1 1 100%; justify-content: center; }
.accent-dot {
    flex: none;
    width: 1.35rem; height: 1.35rem;
    padding: 0; border: none; border-radius: 50%;
    cursor: pointer;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--md-sys-color-outline) 50%, transparent);
    transition: box-shadow 150ms;
}
.accent-dot.selected {
    box-shadow: 0 0 0 2px var(--md-sys-color-surface-container-high),
                0 0 0 3.5px var(--md-sys-color-primary);
}

m3e-list#notif-list {
    overflow-y: auto; flex: 1;
    font-size: 0.85rem;
    padding: 0;
    background: transparent;
}
.notif-item { word-wrap: break-word; white-space: normal; }
.notif-item.warning, .notif-item.error { color: var(--md-sys-color-error); }
#notif-empty {
    padding: 1rem;
    color: var(--md-sys-color-on-surface-variant);
    text-align: center;
    font-size: 0.85rem;
}

/* Model picker menu (m3e-menu, anchored to the app-bar pill by the
   library). Shape, padding, line metrics and sizing are all the
   component's defaults. Only theme integration (surface color + elevation
   onto the mdui tokens) and the scroll extent are mapped. */
#model-menu {
    --m3e-menu-container-color: var(--md-sys-color-surface-container-high);
    --m3e-menu-container-elevation: 0 4px 8px 3px rgba(0,0,0,.3);
    --m3e-menu-container-max-height: 55vh;
}
/* Two-line rows inside the plain radios: the item lays its default slot out
   as a flex row, so one block wrapper stacks the name over the provider.
   Font metrics (line-height, sizes, shape) stay the component's defaults. */
.model-row-main {
    display: block;
    min-width: 0;
}
.model-row-name {
    display: block;
    font-weight: 600;
}
.model-row-spec {
    display: block;
    font-size: 0.74rem;
    color: var(--md-sys-color-on-surface-variant);
}
#model-empty {
    padding: 1rem;
    color: var(--md-sys-color-on-surface-variant);
    text-align: center;
    font-size: 0.85rem;
}

/* Cmd suggestions (above input). Same 28px family as the notif/model panels.
   Rows are inset 0.5rem and rounded 1.25rem (mdui-list-item's native
   "rounded" attribute, whose state layer follows the token) — concentric
   with the panel exactly like the model menu: 28 − 8 = 20. */
#cmd-suggestions {
    position: absolute;
    bottom: 100%;
    /* Right edge stops where the text field stops: composer gap (0.5) plus
       the send capsule (5.25) — the panel matches the input's width, not the
       full footer row that also contains the send button. */
    left: var(--col-pad);
    right: calc(var(--col-pad) + 0.5rem + 5.25rem);
    margin-bottom: 0.25rem;
    background: var(--md-sys-color-surface-container-high);
    border-radius: var(--md-sys-shape-corner-extra-large);
    box-shadow: 0 2px 6px 2px rgba(0,0,0,.3);
    overflow: hidden;
    display: none;
    max-height: 14rem;
    overflow-y: auto;
    padding: 0.5rem;
    box-sizing: border-box;
}
#cmd-suggestions m3e-list { padding: 0; }
#cmd-suggestions m3e-list-item {
    cursor: pointer;
    font-size: 0.9rem;
    --shape-corner-rounded: 1.25rem;
    /* Same two-line recipe as the model menu: bold name, regular detail.
       The shadow parts read these typescale tokens from the host. */
    --md-sys-typescale-body-large-weight: 600;
    --md-sys-typescale-body-medium-weight: 400;
}
#cmd-suggestions m3e-list-item + m3e-list-item { margin-top: 0.1rem; }

/* Scroll-to-bottom (mdui-fab) */
m3e-fab#scroll-bottom {
    position: absolute;
    bottom: 1rem; right: var(--col-pad);
    /* Must out-rank the code-head pill (z-index: 1) — a code block at the
       bottom of the viewport otherwise floats its copy button over this. */
    z-index: 5;
    transform: scale(0) rotate(-45deg);
    opacity: 0;
    pointer-events: none;
    transition: transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease;
    transition: transform 400ms var(--m3e-spring-spatial), opacity 200ms ease;
    box-shadow: none;
}
m3e-fab#scroll-bottom.show {
    transform: scale(1) rotate(0deg);
    opacity: 1;
    pointer-events: auto;
}
m3e-fab#scroll-bottom.show:active { transform: scale(0.92) rotate(0deg); }

/* Turn-time divider */
.turn-time {
    max-width: var(--chat-max-width);
    width: 100%; margin: 0 auto;
    text-align: center;
    font-size: 0.7rem;
    color: var(--md-sys-color-on-surface-variant);
}
/* Timestamps are the same kind of metadata whatever the role — the bubbles
   already carry the role color, so all three stay muted. */
.turn-time.assistant { color: var(--md-sys-color-on-surface-variant); }
.turn-time.user { color: var(--md-sys-color-on-surface-variant); }
.turn-time.system { color: var(--md-sys-color-on-surface-variant); }

/* System note (centered, muted) */
.sysnote {
    max-width: var(--chat-max-width);
    width: 100%; margin: 0 auto;
    text-align: center;
    font-size: 0.78rem;
    color: var(--md-sys-color-on-surface-variant);
    background: var(--md-sys-color-surface-container);
    border-radius: 9999px;
    padding: 0.25rem 0.6rem;
    box-sizing: border-box;
    /* addSystemLine sets textContent, so without this a multi-line note
       (e.g. the /task-config settings table) collapses to one line. */
    white-space: pre-wrap;
}

/* Copy buttons: one circle per code block (in .code-head), one per finished
   assistant bubble (.bubble-copy). Both are identical 2rem circles carrying the
   same glyph; only their anchoring differs.
     - m3e-icon-button's HOST is the painted surface and — unlike the old
       mdui-button-icon — ships NO default corner radius, so the radius has to
       come from here (it wins over the component's :host styles).
     - The component's own surface (the shadow's .base), its state layer, ripple
       and focus ring take their HEIGHT from --m3e-icon-button-container-height
       (default 40px) while their WIDTH is 100% of the host: at a 2rem host that
       painted a 32×40 stadium — a vertical capsule — so the container is pinned
       to the host's own square.
     - The glyph is --m3e-icon-button-icon-size (default 24px) — 3/4 of a 2rem
       circle, which is what read as "the icon is too large" — so it drops to
       1.2rem (19.2px, the MD3 60% ratio against a 32px container).
     - The round shape is forced in every state: the pressed "shape morph" would
       otherwise swap the circle for a squircle mid-tap. */
.copy-btn {
    width: 2rem; height: 2rem;
    border-radius: 999px;
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface-variant);
    --m3e-icon-button-container-height: 2rem;
    --m3e-icon-button-icon-size: 1.2rem;
    --m3e-icon-button-shape-round: 999px;
    --m3e-icon-button-shape-square: 999px;
    --m3e-icon-button-shape-pressed-morph: 999px;
}
.copy-btn.copied { color: var(--md-sys-color-primary); }
.bubble-copy {
    position: absolute;
    /* Concentric with the bubble's top-right arc: the arc's center sits
       (code-r + 0.75rem pad, code-r + 0.75rem pad) in from the corner;
       subtract this button's 1rem radius per axis and the 2rem circle lands
       dead on that center — riding inside the big curve, not overhanging. */
    top: calc(var(--_code-r) - 0.25rem); right: calc(var(--_code-r) - 0.25rem);
    opacity: 0;
    transition: opacity 0.15s;
}
.msg.assistant:hover .bubble-copy { opacity: 1; }
/* Touch devices have no hover — keep the button faintly visible. */
@media (hover: none) { .bubble-copy { opacity: 0.55; } }

/* Prompt dialog (m3e-dialog) in the extra-large corner family (28px).
   Its inner boxes (rec-panel, text field, buttons) sit mid-content —
   never corner-aligned with the dialog's arcs — so the concentric rule
   (outer − inner = gap) does not bind them; they keep their own radii. */

#prompt-card .q { font-size: 0.95rem; line-height: 1.5; }
#prompt-card .rec-panel {
    display: none;
    margin-top: 0.85rem;
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
    padding: 0.75rem;
    border-radius: var(--md-sys-shape-corner-small);
}
#prompt-card .rec-label {
    font-size: 0.72rem;
    opacity: 0.7;
    margin-bottom: 0.3rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
}
#prompt-card .rec-text {
    font-size: 0.9rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
}
#prompt-card .rec-text.md p:first-child { margin-top: 0; }
#prompt-card .rec-text.md p:last-child { margin-bottom: 0; }
#prompt-input { width: 100%; margin-top: 0.85rem; }
#prompt-buttons {
    display: flex; gap: 0.5rem; flex-wrap: wrap;
    justify-content: flex-end;
}
#prompt-buttons m3e-button.cancel { font-size: 0.85rem; }
`

export function mduiHtml(wsUrl: string): string {
    const iconSvg = encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">`
            + `<rect width="180" height="180" rx="38" fill="#6750a4"/>`
            + `<text x="90" y="130" font-family="Georgia,serif" font-size="100" `
            + `text-anchor="middle" fill="#ffffff">π</text></svg>`
    )
    const iconUrl = `data:image/svg+xml,${iconSvg}`
    const manifest = encodeURIComponent(
        JSON.stringify({
            name: 'pi-task remote',
            short_name: 'pi-task',
            display: 'standalone',
            background_color: '#fef7ff',
            theme_color: '#6750a4',
            icons: [{src: iconUrl, sizes: 'any', type: 'image/svg+xml'}]
        })
    )

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="pi-task">
  <meta name="theme-color" content="#6750a4">
  <link rel="apple-touch-icon" href="${iconUrl}">
  <link rel="manifest" href="data:application/manifest+json,${manifest}">
  <title>pi-task remote</title>

  <style>${CSS}</style>
</head>
<body>
  <div id="theme-host" style="display:contents">
    <m3e-theme id="app-theme" variant="tonal-spot" scheme="auto" color="#6750A4" style="display:contents">
  <div id="root">
    <m3e-drawer-container id="drawer" start-mode="over">
      <!-- Session sidebar: populated by the sessions frame, refreshed every
           time the drawer opens. -->
      <nav slot="start" id="session-drawer" aria-label="会话列表">
        <div id="session-drawer-head">
          <span id="session-drawer-title">会话</span>
          <m3e-icon-button id="session-drawer-close" aria-label="关闭"><m3e-icon name="close"></m3e-icon></m3e-icon-button>
        </div>
        <m3e-nav-menu id="session-list" aria-label="会话"></m3e-nav-menu>
      </nav>

      <div id="main-col">
    <main id="chat-wrap">
      <!-- Single compact bar: identity/model + status + actions. mdui's
           top-app-bar drives the hide-on-scroll-down / show-on-scroll-up
           behavior against the chat log as its scroll target (M3E's app-bar
           has no scroll behavior, and the scroller is an inner element, so
           the attribute is set from JS after the DOM is parsed). -->
      <m3e-app-bar id="top-bar" variant="small" scroll-behavior="hide">
        <!-- M3E's app-bar has NO default slot — its content only renders when
           assigned to the named slots (leading / title / subtitle / trailing).
           The old MDUI shell used a single flex wrapper (\`bar-stack\`); M3E
           silently drops unassigned light children, so the bar came up empty
           until the content was re-homed into slots below. -->
        <div id="app-bar" slot="leading">
          <m3e-icon-button id="menu-btn" aria-label="会话列表"><m3e-icon name="menu"></m3e-icon></m3e-icon-button>
          <span id="status-dot"></span>
        </div>
        <div id="app-title" slot="title">
          <div id="model-picker">
            <m3e-menu-trigger for="model-menu" aria-label="切换模型">
              <span id="status-model">π-task remote</span>
              <span id="model-caret" aria-hidden="true"></span>
            </m3e-menu-trigger>
          </div>
          <span id="status-ctx"></span>
        </div>
        <div id="app-actions" slot="trailing">
          <span id="status-chip">disconnected</span>
          <m3e-icon-button id="notif-btn" aria-label="通知"><m3e-icon name="notifications"></m3e-icon></m3e-icon-button>
          <m3e-icon-button id="settings-btn" aria-label="设置"><m3e-icon name="settings"></m3e-icon></m3e-icon-button>
        </div>
      </m3e-app-bar>
      <!-- Context-usage wave: a second row under the bar. M3E's small app-bar
           has no room for it, so it lives as an absolutely-positioned sibling
           in the band below the bar row (cleared by #chat-log's padding-top). -->
      <div id="ctx-stack">
        <div id="ctx-fallback" aria-hidden="true"><i></i></div>
        <m3e-linear-progress-indicator id="ctx-bar-flat" value="0" max="100"
          aria-hidden="true"></m3e-linear-progress-indicator>
        <m3e-linear-progress-indicator id="ctx-bar" variant="wavy" value="0" max="100"
          aria-label="上下文用量"></m3e-linear-progress-indicator>
      </div>
      <div id="chat-log"></div>
      <m3e-fab id="scroll-bottom" variant="tertiary-container" size="small" lowered aria-label="跳到底部" title="跳到底部"><m3e-icon name="arrow_downward"></m3e-icon></m3e-fab>
    </main>

    <!-- Status panel: shows structured task progress (phase / step / elapsed) -->
    <m3e-card id="status-panel" variant="filled" style="display:none"></m3e-card>

    <!-- Held input: lines typed while a task run owns the session -->
    <div id="held-bar" style="display:none">
      <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 20a8 8 0 1 0-8-8 8 8 0 0 0 8 8zm0-18a10 10 0 1 1-10 10A10 10 0 0 1 12 2zm.5 5v5.25l4.5 2.67-.75 1.23L11 13V7z"/></svg>
      <span id="held-label">waiting:</span>
      <span id="held-text"></span>
      <m3e-icon-button id="held-clear" title="清除"><m3e-icon name="close"></m3e-icon></m3e-icon-button>
    </div>

    <footer id="input-bar" style="position:relative;">
      <div id="cmd-suggestions"></div>
      <m3e-form-field variant="filled">
        <textarea id="input" placeholder="输入消息（/ 查看命令）…" rows="1" disabled></textarea>
      </m3e-form-field>
      <m3e-textarea-autosize for="input" min-rows="1" max-rows="6"></m3e-textarea-autosize>
      <m3e-icon-button id="send-btn" variant="filled" disabled aria-label="发送"><m3e-icon name="send" filled></m3e-icon></m3e-icon-button>
    </footer>
      </div><!-- /main-col -->
    </m3e-drawer-container>
  </div>

  <!-- Notifications dropdown: the toggle plus the history list, nothing
       else — appearance and behaviour settings live in #settings-panel. -->
  <div id="notif-panel" aria-hidden="true">
    <div id="notif-toggle-row">
      <span id="notif-title">通知</span>
      <m3e-switch id="notif-toggle"></m3e-switch>
    </div>
    <m3e-list id="notif-list"></m3e-list>
  </div>

  <!-- Settings dropdown: appearance and behaviour only. The theme is a
       three-way connected button group (light / dark / auto) instead of the
       old cycling button — one glance shows the current mode. -->
  <div id="settings-panel" aria-hidden="true">
    <div id="settings-title">设置</div>
    <div class="settings-row">
      <span>深浅色模式</span>
      <m3e-button-group id="theme-seg" variant="connected" size="small">
        <m3e-button variant="tonal" toggle data-value="light">浅色</m3e-button>
        <m3e-button variant="tonal" toggle data-value="dark">深色</m3e-button>
        <m3e-button variant="tonal" toggle data-value="auto" selected>自动</m3e-button>
      </m3e-button-group>
    </div>
    <div class="settings-row">
      <span>主题色</span>
      <div id="accent-list" role="radiogroup" aria-label="主题色">
        <button type="button" class="accent-dot" data-accent="" style="background:#6750A4" title="默认" aria-label="默认"></button>
        <button type="button" class="accent-dot" data-accent="#1E88E5" style="background:#1E88E5" title="蓝色" aria-label="蓝色"></button>
        <button type="button" class="accent-dot" data-accent="#00897B" style="background:#00897B" title="青色" aria-label="青色"></button>
        <button type="button" class="accent-dot" data-accent="#43A047" style="background:#43A047" title="绿色" aria-label="绿色"></button>
        <button type="button" class="accent-dot" data-accent="#EF6C00" style="background:#EF6C00" title="橙色" aria-label="橙色"></button>
        <button type="button" class="accent-dot" data-accent="#D32F2F" style="background:#D32F2F" title="红色" aria-label="红色"></button>
        <button type="button" class="accent-dot" data-accent="#7B1FA2" style="background:#7B1FA2" title="紫色" aria-label="紫色"></button>
        <m3e-button id="accent-extract" variant="tonal" class="accent-extract">从图片提取</m3e-button>
        <input type="file" id="accent-wallpaper" accept="image/*" hidden>
      </div>
    </div>
    <div id="thinking-collapse-row">
      <span>Thinking 自动收起</span>
      <m3e-switch id="thinking-collapse"></m3e-switch>
    </div>
  </div>

  <!-- Model picker menu (m3e-menu): anchored above/below the app-bar pill by
       the library's anchoring, opened by the nested m3e-menu-trigger. Fed by
       the models frame (authed catalogue + current spec) rendered as radio
       items; choosing one sends set_model, and the fresh frame that answers
       re-renders the tick — no optimistic check, so a rejected switch can't
       leave the menu lying. -->
  <m3e-menu id="model-menu" aria-label="切换模型"></m3e-menu>

  <!-- Prompt dialog: shown when pi asks for user input -->
  <m3e-dialog id="prompt-card">
    <div slot="header">π 需要你的输入</div>
    <div class="q" id="prompt-q"></div>
    <div class="rec-panel" id="prompt-rec">
      <div class="rec-label">推荐答案</div>
      <div class="rec-text" id="prompt-rec-text"></div>
    </div>
    <textarea id="prompt-input" placeholder="输入你的回答…" rows="3" style="display:none"></textarea>
    <m3e-textarea-autosize for="prompt-input" min-rows="3" max-rows="8"></m3e-textarea-autosize>
    <div slot="actions" class="row" id="prompt-buttons"></div>
  </m3e-dialog>

  <!-- Reconnect overlay with live countdown -->
  <div id="reconnect-overlay"><span id="reconnect-msg">重新连接中…</span></div>

  <script type="module">
    ${BUNDLE_IMPORTS}
    ${ICON_IMPORTS}
    ${renderModule()}
    ${highlightModule()}
    ${toolsModule()}
    ${stage0Logic(wsUrl)}
  </script>
    </m3e-theme>
  </div>
</body>
</html>`
}

function stage0Logic(wsUrl: string): string {
    return `
    // ───────────── Constants & DOM ─────────────
    const WS_URL_PLACEHOLDER = ${JSON.stringify(wsUrl)};
    const FALLBACK_WS_URL = WS_URL_PLACEHOLDER;
    const WS_URL_RESOLVED = (location && location.host)
      ? (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'
      : FALLBACK_WS_URL;

    const chatLog      = document.getElementById('chat-log');
    // Drive M3E's hide-on-scroll against the chat scroller. The property is
    // guarded because the component only upgrades once its CDN module loads.
    const topBar = document.getElementById('top-bar');
    if (topBar && 'control' in topBar) { try { topBar.control = chatLog; } catch (_) {} }
    const inputEl      = document.getElementById('input');
    const sendBtn      = document.getElementById('send-btn');
    const ctxBar       = document.getElementById('ctx-bar');
    const ctxFlat      = document.getElementById('ctx-bar-flat');
    const ctxStack     = document.getElementById('ctx-stack');
    const ctxFill      = document.getElementById('ctx-fallback').firstElementChild;
    const statusDot    = document.getElementById('status-dot');
    const statusModel  = document.getElementById('status-model');
    const statusCtx    = document.getElementById('status-ctx');
    const statusChip   = document.getElementById('status-chip');
    const overlay      = document.getElementById('reconnect-overlay');
    const reconnectMsg = document.getElementById('reconnect-msg');
    const notifBtn     = document.getElementById('notif-btn');
    const settingsBtn  = document.getElementById('settings-btn');
    const settingsPanel= document.getElementById('settings-panel');
    const themeSeg     = document.getElementById('theme-seg');
    const cmdSuggestions = document.getElementById('cmd-suggestions');
    const scrollBtn    = document.getElementById('scroll-bottom');
    const heldBar      = document.getElementById('held-bar');
    const heldLabel    = document.getElementById('held-label');
    const heldTextEl   = document.getElementById('held-text');
    const heldClearBtn = document.getElementById('held-clear');
    const statusPanel  = document.getElementById('status-panel');
    const promptCard   = document.getElementById('prompt-card');
    const promptQ      = document.getElementById('prompt-q');
    const promptRec    = document.getElementById('prompt-rec');
    const promptRecText= document.getElementById('prompt-rec-text');
    const promptInput  = document.getElementById('prompt-input');
    const promptButtons= document.getElementById('prompt-buttons');
    const notifPanel   = document.getElementById('notif-panel');
    const notifList    = document.getElementById('notif-list');
    const notifToggle  = document.getElementById('notif-toggle');
    const thinkingCollapse = document.getElementById('thinking-collapse');
    const notifTitle   = document.getElementById('notif-title');
    const modelPicker  = document.getElementById('model-picker');
    const modelMenu    = document.getElementById('model-menu');
    const drawer       = document.getElementById('drawer');
    const menuBtn      = document.getElementById('menu-btn');
    const drawerClose  = document.getElementById('session-drawer-close');
    const sessionList  = document.getElementById('session-list');

    // ───────────── State ─────────────
    let connected = false, agentRunning = false, modelName = '';
    let currentBubble = null, streamText = '';
    let reconnectDelay = 1000, reconnectTimer = null, reconnectAnim = null, ws = null;
    let autoScroll = true;
    const toolCallMap = {};
    let currentThinking = null, thinkingText = '';
    let held = [], runHolding = false;
    let taskWidgetLines = null, taskWidgetData = null;
    let turnHadContent = false;
    let activePromptId = null;
    let activeRecommended = '', activeRecommended2 = '', activeActions = [];
    let cancelArmTimer = null;
    let stopArmed = false, stopArmTimer = null;
    let notifHistory = [];
    let notifOpen = false;
    let settingsOpen = false;
    let modelCatalog = {current: null, models: []};
    let modelMenuOpen = false;
    let sessionData = {current: null, sessions: []};

    // M3 Expressive wavy progress (mdui 2.x has no Expressive components yet).
    // Pinned version; loaded async so a slow CDN never blocks the app boot.
    import('https://esm.sh/@m3e/web@2.7.9/progress-indicator').catch(() => {});
    /* The import resolving is not the same as the element being live, and a
       rejected import (offline, LAN-only, blocked CDN) leaves #ctx-bar an
       unknown zero-height tag forever. customElements.whenDefined is the one
       signal that is true exactly when the library is really there: retire
       the CSS fallback and arm the wave only on it. */
    customElements.whenDefined('m3e-linear-progress-indicator').then(() => {
      ctxStack.classList.add('m3e');
      paintCtxWave();
    });
    import('https://esm.sh/@m3e/web@2.7.9/shape').catch(() => {});
    // m3e-icon renders inline SVG for icons registered through the library's
    // registerIcon API and otherwise falls back to ligature text in the
    // "Material Symbols Outlined" font (a multi-MB download). Register the
    // handful of icons this app uses instead; paths are the Material Icons
    // set (Apache-2.0), viewBox 0 0 24 24.
    import('https://esm.sh/@m3e/web@2.7.9/icon').then(m => {
      const VB = '0 0 24 24';
      // name: [outlined path, filled path]
      const iconPaths = {
        send: ['m4.01 6.03 7.51 3.22-7.52-1 .01-2.22m7.5 8.72L4 17.97v-2.22l7.51-1M2.01 3 2 10l15 2-15 2 .01 7L23 12 2.01 3z',
               'M2.01 21 23 12 2.01 3 2 10l15 2-15 2z'],
        stop: ['M16 8v8H8V8h8m2-2H6v12h12V6z',
               'M6 6h12v12H6z'],
        notifications: ['M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-2 1H8v-6c0-2.48 1.51-4.5 4-4.5s4 2.02 4 4.5v6z',
                        'M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z'],
        close: ['M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z',
                'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'],
        arrow_downward: ['m20 12-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z',
                         'm20 12-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z'],
        menu: ['M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
               'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z'],
        history: ['M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
                  'M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9z'],
        check: ['M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
                'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'],
        settings: ['M19.43 12.98c.04-.32.07-.64.07-.98 0-.34-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65A.488.488 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.566.566 0 0 0-.18-.03c-.17 0-.34.09-.43.25l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98 0 .33.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.06.02.12.03.18.03.17 0 .34-.09.43-.25l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zm-1.98-1.71c.04.31.05.52.05.73 0 .21-.02.43-.05.73l-.14 1.13.89.7 1.08.84-.7 1.21-1.27-.51-1.04-.42-.9.68c-.43.32-.84.56-1.25.73l-1.06.43-.16 1.13-.2 1.35h-1.4l-.19-1.35-.16-1.13-1.06-.43c-.43-.18-.83-.41-1.23-.71l-.91-.7-1.06.43-1.27.51-.7-1.21 1.08-.84.89-.7-.14-1.13c-.03-.31-.05-.54-.05-.74s.02-.43.05-.73l.14-1.13-.89-.7-1.08-.84.7-1.21 1.27.51 1.04.42.9-.68c.43-.32.84-.56 1.25-.73l1.06-.43.16-1.13.2-1.35h1.39l.19 1.35.16 1.13 1.06.43c.43.18.83.41 1.23.71l.91.7 1.06-.43 1.27-.51.7 1.21-1.07.85-.89.7.14 1.13zM12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z',
                   'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z'],
        content_copy: ['M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
                'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z'],
        person: ['M12 6c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2m0 10c2.7 0 5.8 1.29 6 2H6c.23-.72 3.31-2 6-2m0-12C9.79 4 8 5.79 8 8s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 10c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z',
                'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'],
        error_outline: ['M11 15h2v2h-2v-2zm0-8h2v6h-2V7zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z',
                'M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z'],
        auto_awesome: ['m19 9 1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25zm0 6-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25zm-7.5-5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zm-1.51 3.49L9 15.17l-.99-2.18L5.83 12l2.18-.99L9 8.83l.99 2.18 2.18.99-2.18.99z',
                'm19 9 1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z']
      };
      for (const name in iconPaths) {
        m.registerIcon(name, 'outlined', {
          outlined: { viewBox: VB, path: iconPaths[name][0] },
          filled:  { viewBox: VB, path: iconPaths[name][1] }
        });
      }
    }).catch(() => {});
    import('https://esm.sh/@m3e/web@2.7.9/icon-button').catch(() => {});
    import('https://esm.sh/@m3e/web@2.7.9/button').catch(() => {});
    // Both are used by the settings panel (the light/dark/auto group and the
    // thinking-collapse row) but were never imported, so those two controls
    // rendered as un-upgraded inline elements.
    import('https://esm.sh/@m3e/web@2.7.9/button-group').catch(() => {});
    import('https://esm.sh/@m3e/web@2.7.9/expansion-panel').catch(() => {});
    import('https://esm.sh/@m3e/web@2.7.9/fab').catch(() => {});
    import('https://esm.sh/@m3e/web@2.7.9/drawer-container').catch(() => {});
    import('https://esm.sh/@m3e/web@2.7.9/nav-menu').catch(() => {});
    import('https://esm.sh/@m3e/web@2.7.9/menu').catch(() => {});
    import('https://esm.sh/@m3e/web@2.7.9/loading-indicator').catch(() => {});
    import('https://esm.sh/@m3e/web@2.7.9/app-bar').catch(() => {});
    import('https://esm.sh/@m3e/web@2.7.9/card').catch(() => {});
    import('https://esm.sh/@m3e/web@2.7.9/dialog').catch(() => {});
    import('https://esm.sh/@m3e/web@2.7.9/list').catch(() => {});
    import('https://esm.sh/@m3e/web@2.7.9/switch').catch(() => {});
    import('https://esm.sh/@m3e/web@2.7.9/form-field').catch(() => {});
    import('https://esm.sh/@m3e/web@2.7.9/textarea-autosize').catch(() => {});
    import('https://esm.sh/@m3e/web@2.7.9/theme').catch(() => {});

    const SPIN = '\u280B\u2819\u2839\u2838\u283C\u2834\u2826\u2827\u2807\u280F';
    let spinIdx = 0, spinTimer = null;
    function spinPaint() {
      const g = SPIN[spinIdx % SPIN.length];
      const els = document.getElementsByClassName('spin');
      for (let i = 0; i < els.length; i++) els[i].textContent = g;
    }
    function startSpin() {
      spinPaint();
      if (spinTimer) return;
      spinTimer = setInterval(function () {
        spinIdx = (spinIdx + 1) % SPIN.length;
        spinPaint();
      }, 90);
    }
    function stopSpinIfIdle() {
      if (spinTimer && !document.querySelector('.spin')) {
        clearInterval(spinTimer); spinTimer = null;
      }
    }

    // ───────────── Theme (in #settings-panel) ─────────────
    // A three-way connected button group (light / dark / auto) sits in the
    // settings panel — former dedicated app-bar button removed. The group
    // reflects the current value and drives setTheme. m3e-button toggles
    // can be clicked off, so the handler re-anchors a bare group and keeps
    // the radios exclusive itself (deterministic even if the group's own
    // slot-level change handling misses a non-composed event).
    const appTheme = document.getElementById('app-theme');
    const storedTheme = localStorage.getItem('pi-task-theme') || 'auto';
    if (appTheme) appTheme.scheme = storedTheme;
    const themeButtons = themeSeg ? Array.from(themeSeg.querySelectorAll('m3e-button')) : [];
    const applyThemeSelection = (val) => {
      for (const b of themeButtons) b.selected = b.getAttribute('data-value') === val;
    };
    applyThemeSelection(storedTheme);
    if (themeSeg) themeSeg.addEventListener('change', (e) => {
      const btn = e.target instanceof Element && e.target.closest ? e.target.closest('m3e-button') : null;
      if (!btn || !themeSeg.contains(btn)) return;
      if (!btn.selected) { btn.selected = true; return; } // never an empty group
      for (const b of themeButtons) if (b !== btn) b.selected = false;
      const next = btn.getAttribute('data-value') || 'auto';
      if (appTheme) appTheme.scheme = next;
      localStorage.setItem('pi-task-theme', next);
      showToast(next === 'auto' ? '跟随系统深浅色' : next === 'dark' ? '已切换为深色模式' : '已切换为浅色模式', 'info');
    });

    // ───────────── Accent color (in #settings-panel) ─────────────
    // Preset seed dots set <m3e-theme>.color, which regenerates the full M3
    // tonal palette for BOTH light and dark from one seed; an empty seed keeps
    // the stock baseline (#6750A4). <m3e-theme> writes --md-sys-color-* directly
    // onto :root, so every m3e component follows automatically. The seed
    // persists and is re-applied on boot before first paint of the chat surface.
    const accentList = document.getElementById('accent-list');
    const accentDots = accentList ? Array.from(accentList.querySelectorAll('.accent-dot')) : [];
    const applyAccent = (seed, persist) => {
      if (appTheme) appTheme.color = seed || '#6750A4';
      for (const d of accentDots) d.classList.toggle('selected', (d.getAttribute('data-accent') || '') === seed);
      if (persist) localStorage.setItem('pi-task-accent', seed);
    };
    applyAccent(localStorage.getItem('pi-task-accent') || '', false);
    if (accentList) accentList.addEventListener('click', (e) => {
      const dot = e.target instanceof Element && e.target.closest ? e.target.closest('.accent-dot') : null;
      if (!dot || !accentList.contains(dot)) return;
      applyAccent(dot.getAttribute('data-accent') || '', true);
    });
    // The mobile browser chrome (address bar / task switcher tile) tints from
    // <meta name="theme-color"> — keep it on the seed too, default = baseline.
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      const applyThemeColor = (seed) => { themeColorMeta.setAttribute('content', seed || '#6750a4'); };
      applyThemeColor(localStorage.getItem('pi-task-accent') || '');
      if (accentList) accentList.addEventListener('click', (e) => {
        const dot = e.target instanceof Element && e.target.closest ? e.target.closest('.accent-dot') : null;
        if (dot && accentList.contains(dot)) applyThemeColor(dot.getAttribute('data-accent') || '');
      });
    }

    // "Extract from image": pick an image, derive its dominant seed color with
    // material-color-utilities (same algorithm as Android's wallpaper theming),
    // and feed it to <m3e-theme> as the new accent seed.
    const accentExtract = document.getElementById('accent-extract');
    const accentWallpaper = document.getElementById('accent-wallpaper');
    if (accentExtract && accentWallpaper) {
      accentExtract.addEventListener('click', () => accentWallpaper.click());
      accentWallpaper.addEventListener('change', async () => {
        const file = accentWallpaper.files && accentWallpaper.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        try {
          const img = new Image();
          img.src = url;
          await img.decode();
          const { getColorFromImage } = await import('https://esm.sh/@m3e/web@2.7.9/theme');
          const hex = await getColorFromImage(img);
          if (appTheme) appTheme.color = hex;
          for (const d of accentDots) d.classList.remove('selected');
          localStorage.setItem('pi-task-accent', hex);
          if (themeColorMeta) themeColorMeta.setAttribute('content', hex);
          showToast('已从图片提取主题色', 'info');
        } catch (e) {
          showToast('提取失败：' + (e && e.message ? e.message : e), 'warning');
        } finally {
          URL.revokeObjectURL(url);
          accentWallpaper.value = '';
        }
      });
    }

    // ───────────── Status ─────────────
    function fmtTokens(n) {
      if (n == null) return '';
      if (n < 1000) return String(n);
      if (n < 10000) return (n / 1000).toFixed(1) + 'k';
      if (n < 1000000) return Math.round(n / 1000) + 'k';
      return (n / 1000000).toFixed(1) + 'M';
    }
    /* pi reports a percent only when it knows BOTH the token count and the
       window: getContextUsage() returns undefined for a model with no
       contextWindow, and {tokens:null, percent:null} until the first
       assistant message after a compaction. A missing percent must never
       mean "keep the old fill" — a frozen bar reads as a working gauge while
       lying — so derive it when the pieces are there and clear it when they
       are not. */
    function ctxPercent(usage) {
      if (!usage) return null;
      if (usage.percent != null) return Math.max(0, Math.min(100, usage.percent));
      if (usage.tokens != null && usage.contextWindow > 0) {
        return Math.max(0, Math.min(100, (usage.tokens / usage.contextWindow) * 100));
      }
      return null;
    }
    function paintCtx(pct) {
      ctxBar.value = pct;
      ctxFlat.value = pct;
      ctxFill.style.width = pct + '%';
      ctxStack.classList.toggle('hot', pct >= 85);
    }
    function setContextBar(usage) {
      paintCtxWave();
      const pct = ctxPercent(usage);
      paintCtx(pct == null ? 0 : pct);
      const parts = [];
      if (pct != null) parts.push(Math.round(pct) + '%');
      if (usage && usage.tokens != null && usage.contextWindow) {
        parts.push(fmtTokens(usage.tokens) + '/' + fmtTokens(usage.contextWindow));
      }
      statusCtx.textContent = parts.join(' · ');
    }
    function setModelName(name) {
      if (name === undefined || name === modelName) return;
      modelName = name || '';
      // The title slot doubles as the model display: before a model is
      // reported, show the app name muted instead of an empty bar.
      statusModel.textContent = modelName || 'π-task remote';
      statusModel.classList.toggle('fallback', !modelName);
    }
    function updateStatusDot() {
      statusDot.className = !connected ? 'disconnected'
                          : agentRunning ? 'connected running'
                          :                 'connected idle';
      statusChip.textContent = !connected ? 'disconnected'
                             : agentRunning ? 'running'
                             :                 'idle';
      paintCtxWave();
    }
    /* m3e's determinate wavy bar rolls its wave continuously by design and
       exposes no pause API (the 1.5s wave-slide is hardcoded, no part
       attribute). Reach into the open shadow root and freeze the wave
       unless a live turn is streaming, so the bar only "breathes" while
       the agent is actually working. */
    function paintCtxWave() {
      const apply = () => {
        ctxStack.classList.toggle('live', agentRunning);
        const p = ctxBar.shadowRoot && ctxBar.shadowRoot.querySelector('.primary path');
        if (p) p.style.animationPlayState = agentRunning ? 'running' : 'paused';
      };
      /* Lit renders asynchronously — a value change in this same task would
         run after a synchronous apply and wipe the play-state again. */
      if (ctxBar.updateComplete && ctxBar.updateComplete.then) {
        ctxBar.updateComplete.then(apply);
      } else {
        requestAnimationFrame(apply);
      }
    }
    function setSendBtn() {
      sendBtn.classList.toggle('running', agentRunning);
      const icon = sendBtn.querySelector('m3e-icon');
      if (icon) icon.name = agentRunning ? 'stop' : 'send';
    }

    // ───────────── Custom scrollbars ─────────────
    /* Native scrollbars are hidden app-wide; this overlay thumb replaces
       them on the main surfaces: fades in while scrolling, idles out after
       700ms, and is draggable (1px of thumb travel = scrollHeight/clientHeight
       px of content). host must be a positioned ancestor of scroller. */
    // opts.inset / opts.rightInset: the thumb's end gap and right gap. On the
    // rounded command panel both are 28 (corner) - 2.5 (cap radius) = 25.5px,
    // which translates the thumb so its round caps' centers land exactly on
    // the card corners' arc centers — the parallel-shift concentric design.
    function attachScrollbar(scroller, host, opts) {
      opts = opts || {};
      const inset = opts.inset != null ? opts.inset : 4;
      const rightInset = opts.rightInset != null ? opts.rightInset : 6;
      const thumb = document.createElement('div');
      thumb.className = 'scroll-thumb';
      host.appendChild(thumb);
      let hideTimer = null, dragging = false, startPointerY = 0, startScrollTop = 0;
      function paint() {
        const max = scroller.scrollHeight - scroller.clientHeight;
        if (max <= 2) { thumb.style.display = 'none'; return; }
        thumb.style.display = 'block';
        const track = scroller.clientHeight - inset * 2;
        const h = Math.max(28, Math.round(scroller.clientHeight * scroller.clientHeight / scroller.scrollHeight));
        const top = scroller.getBoundingClientRect().top - host.getBoundingClientRect().top
          + inset + (max ? (scroller.scrollTop / max) * Math.max(0, track - h) : 0);
        const right = host.getBoundingClientRect().right - scroller.getBoundingClientRect().right + rightInset;
        thumb.style.height = h + 'px';
        thumb.style.top = top + 'px';
        thumb.style.right = right + 'px';
      }
      function show() {
        paint();
        thumb.classList.add('on');
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => { if (!dragging) thumb.classList.remove('on'); }, 700);
      }
      thumb.addEventListener('pointerdown', (e) => {
        dragging = true;
        startPointerY = e.clientY;
        startScrollTop = scroller.scrollTop;
        thumb.classList.add('dragging');
        thumb.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      thumb.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const max = scroller.scrollHeight - scroller.clientHeight;
        const track = scroller.clientHeight - inset * 2;
        const h = parseFloat(thumb.style.height) || 28;
        scroller.scrollTop = startScrollTop + (e.clientY - startPointerY) * (max / Math.max(1, track - h));
      });
      const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        thumb.classList.remove('dragging');
        try { thumb.releasePointerCapture(e.pointerId); } catch (err) {}
        show();
      };
      thumb.addEventListener('pointerup', endDrag);
      thumb.addEventListener('pointercancel', endDrag);
      scroller.addEventListener('scroll', show);
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(show).observe(scroller);
      show();
      return { paint };
    }
    attachScrollbar(chatLog, document.getElementById('chat-wrap'));
    // The command panel is the rounded card: 28px corner - 2.5px cap = 25.5px
    // on both axes, so the thumb's end caps sit concentric with its corners.
    const cmdScrollbar = attachScrollbar(cmdSuggestions, document.getElementById('input-bar'),
      { inset: 25.5, rightInset: 25.5 });
    attachScrollbar(notifList, notifPanel);

    // ───────────── Scroll tracking ─────────────
    function atBottom() {
      return chatLog.scrollTop + chatLog.clientHeight >= chatLog.scrollHeight - 24;
    }
    function scrollBottom() {
      if (autoScroll) {
        /* Instant jump, never smooth: deltas arrive faster than a smooth
           animation converges, and the mid-flight lag trips the scroll
           handler's atBottom() check, which disengages auto-scroll for the
           rest of the stream. An exact jump keeps every scroll event at the
           bottom, so the handler always re-confirms auto-scroll. */
        chatLog.scrollTop = chatLog.scrollHeight;
      }
      scrollBtn.classList.toggle('show', !atBottom());
      /* Auto-scroll counts as "scrolling down" to the top-app-bar's hide
         behavior — the bar must not collapse just because a reply arrived.
         Double rAF: the component re-hides from its own throttled scroll
         handler one frame after ours, so reset on the frame after that. */
      requestAnimationFrame(() => requestAnimationFrame(() => {

      }));
    }
    chatLog.addEventListener('scroll', () => {
      autoScroll = atBottom();
      scrollBtn.classList.toggle('show', !autoScroll);
    });
    /* User intent beats the race where a queued delta task re-jumps to the
       bottom before the scroll handler can see the user's upward scroll. */
    const userScrollIntent = () => {
      autoScroll = false;
      scrollBtn.classList.toggle('show', !atBottom());
    };
    chatLog.addEventListener('wheel', userScrollIntent, {passive: true});
    chatLog.addEventListener('touchmove', userScrollIntent, {passive: true});
    scrollBtn.addEventListener('click', () => {
      autoScroll = true;
      chatLog.scrollTo({ top: chatLog.scrollHeight, behavior: 'smooth' });
      const hideWhenDone = () => {
        scrollBtn.classList.remove('show');
        chatLog.removeEventListener('scrollend', hideWhenDone);
      };
      chatLog.addEventListener('scrollend', hideWhenDone);
      setTimeout(hideWhenDone, 500);
    });

    // ───────────── Bubbles (Stage 1: Markdown) ─────────────
    function setContent(el, text) {
      el.classList.add('md');
      mountMarkdown(el, text);
    }
    // The markdown module emits a plain <button class="copy-btn"> in each code
    // header. Swap it for a real MD3 icon button (state layer, ripple, theme).
    function mountMarkdown(el, text) {
      el.innerHTML = renderMarkdown(text);
      el.querySelectorAll('.code-head .copy-btn').forEach((b) => {
        const btn = document.createElement('m3e-icon-button');
        btn.type = 'button';
        btn.className = 'copy-btn';
        // m3e-icon-button does NOT render its icon property (the slotted
        // <m3e-icon> is what actually paints) — so give it a real child icon,
        // the same way #send-btn carries its glyph. Setting .icon='content_copy'
        // leaves a blank circle.
        const ic = document.createElement('m3e-icon');
        ic.setAttribute('name', 'content_copy');
        btn.appendChild(ic);
        btn.setAttribute('aria-label', '复制代码');
        b.replaceWith(btn);
      });
    }
    // User stays a plain circle; pi (and errors) wear the M3 Expressive
    // flower from @m3e/web's shape library.
    function makeAvatar(role) {
      const icon = role === 'user'
        ? '<m3e-icon name="person"></m3e-icon>'
        : role === 'error'
          ? '<m3e-icon name="error_outline"></m3e-icon>'
          : '<m3e-icon name="auto_awesome"></m3e-icon>';
      const s = document.createElement('m3e-shape');
      s.name = role === 'user' ? 'arch' : '4-leaf-clover';
      s.className = 'avatar';
      const fill = document.createElement('div');
      fill.className = 'avatar-fill'
        + (role === 'error' ? ' error' : role === 'user' ? ' user' : '');
      fill.innerHTML = icon;
      s.appendChild(fill);
      return s;
    }
    function addBubble(role, text) {
      const wrap = document.createElement('div');
      wrap.className = 'msg ' + role;
      const avatar = makeAvatar(role);
      const bub = document.createElement('div');
      bub.className = 'bubble';
      if (role === 'assistant') {
        bub.classList.add('md');
        mountMarkdown(bub, text);
        attachBubbleCopy(bub, text);
      } else {
        bub.textContent = text;
      }
      wrap.appendChild(avatar);
      wrap.appendChild(bub);
      chatLog.appendChild(wrap);
      scrollBottom();
      return bub;
    }
    function appendTextDelta(delta) {
      if (!currentBubble) {
        const wrap = document.createElement('div');
        wrap.className = 'msg assistant';
        const av = makeAvatar('assistant');
        const bub = document.createElement('div');
        bub.className = 'bubble md';
        wrap.appendChild(av); wrap.appendChild(bub);
        chatLog.appendChild(wrap);
        currentBubble = bub;
        streamText = '';
      }
      streamText += delta;
      currentBubble.textContent = streamText;
      scrollBottom();
    }
    function closeBubble() {
      if (currentBubble && streamText) {
        mountMarkdown(currentBubble, streamText);
        attachBubbleCopy(currentBubble, streamText);
      }
      currentBubble = null; streamText = '';
    }
    function attachBubbleCopy(el, rawText) {
      el.__copyText = rawText;
      const b = document.createElement('m3e-icon-button');
      b.type = 'button';
      b.className = 'copy-btn bubble-copy';
      const ic = document.createElement('m3e-icon');
      ic.setAttribute('name', 'content_copy');
      b.appendChild(ic);
      b.setAttribute('aria-label', '复制消息');
      el.appendChild(b);
    }
    chatLog.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('.copy-btn');
      if (!btn) return;
      // A code-block copy button copies only that block; a bubble copy button
      // copies the whole message. Both are styled by .copy-btn upstream.
      const block = btn.closest('.code-block');
      if (block) {
        const code = block.querySelector('code');
        copyText(code ? code.textContent : '', btn);
        return;
      }
      const bub = btn.closest('.bubble');
      if (!bub) return;
      copyText(bub.__copyText != null ? bub.__copyText : bub.textContent, btn);
    });
    function flashCopied(btn) {
      if (!btn) return;
      const ic = btn.querySelector('m3e-icon');
      if (ic) ic.setAttribute('name', 'check');
      btn.classList.add('copied');
      setTimeout(() => { if (ic) ic.setAttribute('name', 'content_copy'); btn.classList.remove('copied'); }, 1200);
    }
    function fallbackCopy(text, btn) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        flashCopied(btn);
      } catch (e) {}
    }
    function copyText(text, btn) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => flashCopied(btn), () => fallbackCopy(text, btn));
      } else {
        fallbackCopy(text, btn);
      }
    }

    // ───────────── Turn time / system line ─────────────
    function fmtClock(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      const pad = n => (n < 10 ? '0' : '') + n;
      return pad(d.getHours()) + ':' + pad(d.getMinutes());
    }
    function addTurnTime(ts, roleClass) {
      const el = document.createElement('div');
      el.className = 'turn-time ' + roleClass;
      el.textContent = fmtClock(ts || Date.now());
      chatLog.appendChild(el);
      scrollBottom();
    }
    function addSystemLine(text) {
      const el = document.createElement('div');
      el.className = 'sysnote';
      el.textContent = text;
      chatLog.appendChild(el);
      scrollBottom();
      return el;
    }

    // ───────────── Stage 2: Thinking ─────────────
    function thinkingSummary(n) {
      return 'Thinking… (' + n + (n === 1 ? ' line' : ' lines') + ')';
    }
    function thinkingLineCount(text) {
      return text ? text.split('\\n').length : 0;
    }
    function makeThinkingEl(text, live) {
      const wrap = document.createElement('m3e-expansion-panel');
      wrap.className = 'thinking';
      // The card draws its own chevron (.thinking-header::before, left of the
      // label); m3e-expansion-panel would add a second one on the right.
      // hide-toggle forwards to the inner m3e-expansion-header and drops it.
      wrap.setAttribute('hide-toggle', '');
      const header = document.createElement('div');
      header.setAttribute('slot', 'header');
      header.className = 'thinking-header';
      // The live loading indicator marks streaming; finished cards carry the
      // label alone — a spinner on a folded card would read as activity
      // that isn't there.
      if (live) {
        const spin = document.createElement('m3e-loading-indicator');
        spin.className = 'thinking-spin';
        header.appendChild(spin);
      }
      const lbl = document.createElement('span');
      lbl.className = 'thinking-label';
      lbl.textContent = thinkingSummary(thinkingLineCount(text));
      header.appendChild(lbl);
      const body = document.createElement('pre');
      body.className = 'thinking-body';
      body.textContent = text || '';
      wrap.appendChild(header);
      wrap.appendChild(body);
      if (live || !text) wrap.open = true;
      chatLog.appendChild(wrap);
      scrollBottom();
      return wrap;
    }
    function appendThinkingDelta(delta) {
      if (!currentThinking) {
        currentThinking = makeThinkingEl('', true);
        thinkingText = '';
        startSpin();
      }
      thinkingText += delta;
      currentThinking.querySelector('.thinking-body').textContent = thinkingText;
      currentThinking.querySelector('.thinking-label').textContent =
        thinkingSummary(thinkingLineCount(thinkingText));
      scrollBottom();
    }
    function finalizeThinking() {
      if (currentThinking) {
        /* Streaming stays expanded so you can watch it think; on completion
           the block folds back up unless the user turned that off. */
        if (thinkingAutoCollapse()) {
          currentThinking.open = false;
        }
        currentThinking.querySelector('.thinking-spin')?.remove();
        currentThinking = null; thinkingText = '';
        stopSpinIfIdle();
      } else {
        thinkingText = '';
      }
    }

    // ───────────── Stage 2: Tool call cards ─────────────
    // Returns a small facade {root, header, body} over the m3e-expansion-panel
    // structure so call sites can append results/elapsed without knowing it.
    function addToolCall(toolName, args, toolCallId, isError) {
      const wrap = document.createElement('m3e-expansion-panel');
      wrap.className = 'tool-call' + (isError ? ' error' : '');
      wrap.id = 'tool-' + toolCallId;
      // Same as .thinking: the card's own ::before chevron is the only one.
      wrap.setAttribute('hide-toggle', '');
      const header = document.createElement('div');
      header.setAttribute('slot', 'header');
      header.className = 'tool-header';
      const lbl = document.createElement('span');
      lbl.className = 'tool-label';
      lbl.textContent = toolSummary(toolName, args);
      header.appendChild(lbl);
      const badge = toolBadge(toolName, args);
      if (badge && (badge.added || badge.removed)) {
        const b = document.createElement('span');
        b.className = 'tool-badge';
        b.textContent = '+' + badge.added + ' −' + badge.removed;
        header.appendChild(b);
      }
      const body = document.createElement('div');
      body.className = 'tool-body';
      const diffHtml = toolDiffHtml(toolName, args);
      if (diffHtml) {
        const dv = document.createElement('div');
        dv.className = 'tool-diff';
        dv.innerHTML = diffHtml;
        body.appendChild(dv);
      }
      wrap.appendChild(header);
      wrap.appendChild(body);
      chatLog.appendChild(wrap);
      scrollBottom();
      return { root: wrap, header: header, body: body };
    }
    function appendElapsed(d, elapsedMs) {
      const s = d && d.header;
      if (!s || s.querySelector('.tool-elapsed')) return;
      const txt = fmtElapsed(elapsedMs);
      if (!txt) return;
      const e = document.createElement('span');
      e.className = 'tool-elapsed';
      e.textContent = '· ' + txt;
      s.appendChild(e);
    }
    function contentBlocksText(result) {
      const blocks = Array.isArray(result) ? result
        : (result && Array.isArray(result.content)) ? result.content
        : null;
      if (!blocks) return null;
      const parts = [];
      for (const b of blocks) {
        if (typeof b === 'string') parts.push(b);
        else if (b && b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
      }
      return parts.length ? parts.join('\\n') : null;
    }
    function toolResultText(result) {
      if (result == null) return '';
      if (typeof result === 'string') return result.slice(0, 8000);
      const text = contentBlocksText(result);
      const r = text != null ? text : JSON.stringify(result, null, 2);
      return (r == null ? '' : r).slice(0, 8000);
    }

    // ───────────── Stage 3: Held bar ─────────────
    function renderHeld() {
      if (!held.length) { heldBar.style.display = 'none'; return; }
      heldBar.style.display = 'flex';
      heldLabel.textContent = held.length === 1
        ? 'waiting for the task turn:'
        : held.length + ' waiting for the task turn:';
      heldTextEl.textContent = held.join(' · ');
    }
    heldClearBtn.addEventListener('click', () => {
      if (!ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ type: 'clear_held' }));
    });

    // ───────────── Stage 3: Widget panel ─────────────
    function renderWidgets() {
      if (taskWidgetData) {
        statusPanel.classList.add('structured');
        statusPanel.style.display = 'block';
        const d = taskWidgetData;
        const title = '<div class="widget-title">' + escHtml(d.title || '') + '</div>';
        const meta = '<div class="widget-meta">'
          + (d.phase ? '<span class="widget-phase">' + escHtml(d.phase) + '</span>' : '')
          + (d.total > 0 && d.done != null ? '<span class="widget-step">' + d.done + '/' + d.total + '</span>' : '')
          + (d.elapsed ? '<span class="widget-elapsed">' + escHtml(d.elapsed) + '</span>' : '')
          + '</div>';
        let bar = '';
        if (d.total > 0 && d.done != null) {
          bar = '<m3e-linear-progress-indicator class="widget-bar" variant="wavy"'
            + ' value="' + d.done + '" max="' + d.total + '"'
            + ' aria-label="task progress"></m3e-linear-progress-indicator>';
        }
        const action = d.action ? '<div class="widget-action">↳ ' + escHtml(d.action) + '</div>' : '';
        statusPanel.innerHTML = title + meta + bar + action;
        return;
      }
      statusPanel.classList.remove('structured');
      if (taskWidgetLines && taskWidgetLines.length) {
        statusPanel.textContent = taskWidgetLines.join('\\n');
        statusPanel.style.display = 'block';
      } else {
        statusPanel.style.display = 'none';
      }
    }

    // ───────────── Stage 3: Toast + notif history ─────────────
    function showToast(message, level) {
      const prefix = level === 'error' ? '✕ ' : level === 'warning' ? '⚠ ' : '';
      // Recorded first: the history panel must survive a CDN that will not load.
      recordNotif(message, level);
      // The @m3e/web snackbar subpath exports the M3eSnackbar class, not a
      // snackbar() function, so the call is M3eSnackbar.open(text, options).
      // The options this used to pass (placement/closeable/autoCloseDelay) were
      // mdui 2.x's shape and are silently ignored here — m3e's own names are
      // duration/closeLabel. Loaded lazily so a CDN failure costs a toast, not
      // the whole client.
      import('https://esm.sh/@m3e/web@${M3E_VERSION}/snackbar')
        .then((mod) => mod.M3eSnackbar.open(prefix + message, {duration: 4000}))
        .catch(() => {});
    }
    function recordNotif(message, level) {
      notifHistory.unshift({message, level: level || 'info', ts: Date.now()});
      if (notifHistory.length > 20) notifHistory.pop();
      if (notifOpen) renderNotifList();
    }
    function renderNotifList() {
      if (!notifHistory.length) {
        notifList.innerHTML = '<div id="notif-empty">还没有通知</div>';
        return;
      }
      const LEVEL_ICON = { error: 'error', warning: 'warning_amber', info: 'info' };
      let html = '';
      for (let i = 0; i < notifHistory.length; i++) {
        const n = notifHistory[i];
        html += '<m3e-list-item class="notif-item ' + escHtml(n.level) + '">'
          + '<m3e-icon slot="start" name="' + (LEVEL_ICON[n.level] || 'info') + '"></m3e-icon>'
          + '<div slot="headline">' + escHtml(n.message) + '</div>'
          + '<div slot="supporting-text">' + escHtml(fmtClock(n.ts)) + '</div>'
          + '</m3e-list-item>';
      }
      notifList.innerHTML = html;
    }

    // ───────────── Stage 3: Bell + push ─────────────
    const NOTIFY_KEY = 'piRemoteNotify';
    const THINKING_COLLAPSE_KEY = 'piRemoteThinkingCollapse';
    function thinkingAutoCollapse() {
      return localStorage.getItem(THINKING_COLLAPSE_KEY) !== '0';
    }
    function updateThinkingCollapseSwitch() {
      thinkingCollapse.checked = thinkingAutoCollapse();
    }
    function notifyEnabled() {
      return localStorage.getItem(NOTIFY_KEY) === '1'
        && typeof Notification !== 'undefined'
        && Notification.permission === 'granted';
    }
    function notifyEnvIssue() {
      if (typeof Notification === 'undefined') return '此浏览器不支持通知。';
      if (!window.isSecureContext) return '通知需要 HTTPS。请用 Tailscale https URL 或 localhost 打开。';
      const isIOS = /iP(hone|ad|od)/i.test(navigator.userAgent);
      const standalone = navigator.standalone === true
        || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      if (isIOS && !standalone) return 'iOS 用户：请先分享 → 添加到主屏幕，再启用通知。';
      return null;
    }
    function updateBell() {
      const on = notifyEnabled();
      notifBtn.classList.toggle('on', on);
      notifToggle.checked = on;
      updateThinkingCollapseSwitch();
    }
    function setNotifOpen(open) {
      notifOpen = open;
      notifPanel.classList.toggle('open', open);
      notifPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (open) { renderNotifList(); updateBell(); }
    }
    function setSettingsOpen(open) {
      settingsOpen = open;
      settingsPanel.classList.toggle('open', open);
      settingsPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (open) updateThinkingCollapseSwitch();
    }
    thinkingCollapse.addEventListener('change', () => {
      localStorage.setItem(THINKING_COLLAPSE_KEY, thinkingCollapse.checked ? '1' : '0');
      if (thinkingCollapse.checked) {
        document.querySelectorAll('m3e-expansion-panel.thinking[open]').forEach((c) => {
          c.open = false;
        });
      }
      showToast(thinkingCollapse.checked ? 'Thinking 将在结束时收起' : 'Thinking 保持展开', 'info');
    });
    function togglePush() {
      if (localStorage.getItem(NOTIFY_KEY) === '1') {
        localStorage.setItem(NOTIFY_KEY, '0');
        updateBell();
        showToast('通知已关闭', 'info');
        return;
      }
      const issue = notifyEnvIssue();
      if (issue) { showToast(issue, 'warning'); return; }
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        showToast('此浏览器不支持 Web Push。', 'warning');
        return;
      }
      Notification.requestPermission().then((perm) => {
        if (perm !== 'granted') {
          showToast('通知权限被拒绝，请在浏览器设置中启用。', 'warning');
          return;
        }
        subscribePush().then((ok) => {
          if (ok) {
            localStorage.setItem(NOTIFY_KEY, '1');
            showToast('通知已开启。', 'info');
          } else {
            showToast('通知订阅失败。', 'warning');
          }
          updateBell();
        }).catch((e) => {
          showToast('通知设置失败：' + (e && e.message ? e.message : e), 'warning');
          updateBell();
        });
      });
    }
    function urlB64ToUint8Array(base64) {
      const pad = '='.repeat((4 - base64.length % 4) % 4);
      const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
      const raw = atob(b64);
      const arr = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
      return arr;
    }
    function subscribePush() {
      return navigator.serviceWorker.register('/sw.js')
        .then(() => navigator.serviceWorker.ready)
        .then((reg) => fetch('/push-key').then((r) => r.text()).then((key) =>
          reg.pushManager.getSubscription().then((existing) =>
            existing || reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlB64ToUint8Array(key.trim())
            })
          )
        ))
        .then((sub) => fetch('/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sub)
        }).then((r) => r.ok));
    }
    function closeModelMenu() {
      if (modelMenuOpen) modelMenu.hide(false);
    }
    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeModelMenu();
      setSettingsOpen(false);
      setNotifOpen(!notifOpen);
    });
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeModelMenu();
      setNotifOpen(false);
      setSettingsOpen(!settingsOpen);
    });
    document.addEventListener('click', (e) => {
      if (notifOpen && !notifPanel.contains(e.target) && e.target !== notifBtn) {
        setNotifOpen(false);
      }
      if (settingsOpen && !settingsPanel.contains(e.target) && e.target !== settingsBtn) {
        setSettingsOpen(false);
      }
    });
    notifToggle.addEventListener('change', togglePush);
    updateBell();

    // ───────────── Model picker menu ─────────────
    // Fed by the server's models frame (on connect, on session_start and after
    // each switch). Rendered as m3e-menu-item-radio rows inside the anchored
    // m3e-menu; choosing one sends set_model, and the fresh frame that comes
    // back re-renders the tick — no optimistic check, so a rejected switch
    // can't leave the menu lying.
    function escAttr(s) {
      return escHtml(s).replace(/"/g, '&quot;');
    }
    function renderModelMenu() {
      if (!modelCatalog.models.length) {
        modelMenu.innerHTML = '<div id="model-empty">暂无可切换的模型</div>';
        return;
      }
      let html = '';
      for (const md of modelCatalog.models) {
        const cur = md.spec === modelCatalog.current;
        const provider = md.spec.split('/')[0] || md.spec;
        html += '<m3e-menu-item-radio data-spec="' + escAttr(md.spec) + '"'
              + (cur ? ' checked' : '') + '>'
              // Single root child: the item lays its default-slot content out
              // as a flex ROW (leading check + label), so the two text lines
              // must live inside one wrapper to stack vertically.
              + '<span class="model-row-main">'
              + '<span class="model-row-name">' + escHtml(md.name) + '</span>'
              + '<span class="model-row-spec">' + escHtml(provider) + '</span>'
              + '</span>'
              + '</m3e-menu-item-radio>';
      }
      modelMenu.innerHTML = html;
    }
    // The trigger opens/closes the menu; we only mirror the state onto the
    // pill (tonal highlight + caret flip) and refresh the rows on open.
    modelMenu.addEventListener('toggle', () => {
      const open = modelMenu.isOpen;
      modelMenuOpen = open;
      modelPicker.classList.toggle('open', open);
      if (open) { setNotifOpen(false); renderModelMenu(); }
    });
    modelMenu.addEventListener('click', (e) => {
      const row = e.target && e.target.closest ? e.target.closest('m3e-menu-item-radio') : null;
      if (!row) return;
      const spec = row.getAttribute('data-spec');
      if (!spec || !ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ type: 'set_model', spec }));
      const chosen = modelCatalog.models.find((x) => x.spec === spec);
      showToast(chosen ? '切换模型：' + chosen.name : '切换模型…', 'info');
      modelMenu.hide(false);
    });

    // ───────────── Session sidebar ─────────────
    // Fed by the server's sessions frame (on connect and every drawer open).
    // Tapping a row asks the server to switchSession; the replacement re-runs
    // registration, whose session_start resets the view and backfills the
    // target transcript, so the update arrives as frames — never optimistic.
    function fmtSessionTime(iso) {
      const d = new Date(iso);
      if (isNaN(d)) return '';
      const now = new Date();
      if (d.toDateString() === now.toDateString()) {
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
      }
      const md = (d.getMonth() + 1) + '/' + d.getDate();
      return d.getFullYear() === now.getFullYear() ? md : d.getFullYear() + '/' + md;
    }
    function syncSessionItem(it, s, cur) {
      it._sessionPath = s.path;
      // The unsaved row is the session pi has not flushed to disk yet (a
      // brand-new conversation): it has no timestamp or message count to show,
      // and calling it 空会话 would read as some stale empty conversation
      // instead of the one being typed into right now.
      it.querySelector('.s-title').textContent =
        s.name || s.firstMessage || (s.unsaved ? '（新会话·尚未保存）' : '（空会话）');
      it.querySelector('.s-sub').textContent = s.unsaved
        ? '当前会话 · 尚未写入磁盘'
        : fmtSessionTime(s.modified) + ' · ' + s.messageCount + ' 条消息';
      // toggleAttribute is a no-op when unchanged: the freshly clicked item
      // already carries native selected, so the indicator's grow animation
      // is never restarted by a data refresh.
      it.toggleAttribute('selected', !!cur);
    }
    function renderSessions() {
      const sessions = sessionData.sessions || [];
      if (!sessions.length) {
        sessionList.innerHTML = '<div class="s-empty">还没有其他会话</div>';
        return;
      }
      // Keyed in-place update: when the catalogue is unchanged (same paths,
      // same order), sync text + selection on the existing items instead of
      // rebuilding. Recreating the nodes re-mounts the selected item, which
      // replays the indicator animation and flashes the whole row.
      const existing = sessionList.querySelectorAll('m3e-nav-menu-item');
      const sameOrder = existing.length === sessions.length
        && [...existing].every((el, i) => el._sessionPath === sessions[i].path);
      if (!sameOrder) {
        sessionList.innerHTML = '';
        for (const s of sessions) {
          const it = document.createElement('m3e-nav-menu-item');
          const ic = document.createElement('m3e-icon');
          ic.slot = 'icon';
          ic.setAttribute('name', 'history');
          const label = document.createElement('span');
          label.slot = 'label';
          label.className = 's-label';
          const title = document.createElement('span');
          title.className = 's-title';
          const sub = document.createElement('span');
          sub.className = 's-sub';
          label.append(title, sub);
          it.append(ic, label);
          it.addEventListener('click', () => {
            drawer.start = false;
            if (!ws || ws.readyState !== 1) return;
            // Compare against the SERVER's current session, never against the
            // selected attribute. m3e-nav-menu-item marks the row that was
            // clicked (selected + aria-current) from INSIDE its own shadow DOM,
            // and that mutation lands before this host-level bubble listener
            // runs — so an attribute check swallowed every real tap and no row
            // could ever be switched (a synthetic el.click() bypasses the
            // shadow internals and looks fine, which is how it hid). Path
            // equality is the same fact with no timing trap.
            if (it._sessionPath === sessionData.current) return;
            ws.send(JSON.stringify({ type: 'switch_session', path: it._sessionPath }));
            showToast('切换会话…', 'info');
          });
          syncSessionItem(it, s, s.path === sessionData.current);
          sessionList.appendChild(it);
        }
        return;
      }
      sessions.forEach((s, i) => syncSessionItem(existing[i], s, s.path === sessionData.current));
    }
    menuBtn.addEventListener('click', () => {
      drawer.start = true;
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'list_sessions' }));
    });
    drawerClose.addEventListener('click', () => {
      drawer.start = false;
    });

    // ───────────── Stage 3: Command autocomplete ─────────────
    const COMMANDS = [
      { name: '/task',             desc: 'Start a new task' },
      { name: '/task-plan',        desc: 'Plan one task with the model, then run it' },
      { name: '/task-list',        desc: 'List tasks in this project' },
      { name: '/task-resume',      desc: 'Resume a task' },
      { name: '/task-cancel',      desc: 'Cancel the currently running task' },
      { name: '/task-auto',        desc: 'Plan a feature into tasks and run them' },
      { name: '/task-auto-resume', desc: 'Resume the active /task-auto run' },
      { name: '/task-auto-cancel', desc: 'Stop the running /task-auto loop' },
      { name: '/new',              desc: 'Start a new session' },
      { name: '/compact',          desc: 'Compact context to save tokens' },
      { name: '/remote stop',      desc: 'Stop the remote server' },
    ];
    let cmdActive = [], cmdIndex = -1;
    function updateSuggestions() {
      const val = inputEl.value || '';
      if (!val.startsWith('/')) { cmdActive = []; cmdIndex = -1; renderSuggestions(); return; }
      cmdActive = COMMANDS.filter((c) => c.name.startsWith(val));
      cmdIndex = cmdActive.length === 1 ? 0 : -1;
      renderSuggestions();
    }
    function renderSuggestions() {
      cmdSuggestions.innerHTML = '';
      if (!cmdActive.length) { cmdSuggestions.style.display = 'none'; return; }
      cmdSuggestions.style.display = 'block';
      const list = document.createElement('m3e-list');
      cmdActive.forEach((cmd, i) => {
        const el = document.createElement('m3e-list-item');
        // mdui's native rounded variant: the row (and its ripple/state
        // layer) becomes a rounded rect inset from the panel — the model
        // menu's recipe, not a full-bleed highlight.
        el.setAttribute('rounded', '');
        if (i === cmdIndex) el.setAttribute('active', '');
        el.setAttribute('headline', cmd.name);
        el.setAttribute('description', cmd.desc);
        el.addEventListener('mousedown', (e) => { e.preventDefault(); pickCmd(i); });
        list.appendChild(el);
      });
      cmdSuggestions.appendChild(list);
      if (cmdScrollbar) cmdScrollbar.paint();
    }
    function pickCmd(i) {
      const cmd = cmdActive[i];
      if (!cmd) return;
      inputEl.value = cmd.name + ' ';
      cmdActive = []; cmdIndex = -1; renderSuggestions();
      inputEl.focus();
    }

    // ───────────── Composer + stop-arm ─────────────
    function refreshComposer() {
      updateStatusDot();
      const promptOpen = activePromptId !== null;
      inputEl.disabled = !connected || promptOpen;
      inputEl.placeholder = agentRunning
        ? 'steers the live turn'
        : (runHolding
            ? 'held for the next task turn'
            : 'type a message… (/ 查看命令)');
      if (agentRunning && !promptOpen) {
        sendBtn.classList.add('stop');
        sendBtn.disabled = !connected;
        if (!stopArmed) sendBtn.title = 'Send → Stop';
      } else {
        disarmStop();
        sendBtn.classList.remove('stop');
        sendBtn.disabled = !connected || promptOpen;
        sendBtn.title = 'Send';
      }
    }
    function disarmStop() {
      stopArmed = false;
      if (stopArmTimer) { clearTimeout(stopArmTimer); stopArmTimer = null; }
      if (agentRunning) sendBtn.classList.remove('armed');
    }
    function sendInterrupt() {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'interrupt' }));
      }
    }
    function onSendClick() {
      if (agentRunning && activePromptId === null) {
        if (stopArmed) { disarmStop(); sendInterrupt(); return; }
        stopArmed = true;
        sendBtn.classList.add('armed');
        if (stopArmTimer) clearTimeout(stopArmTimer);
        stopArmTimer = setTimeout(() => { stopArmed = false; sendBtn.classList.remove('armed'); }, 3000);
        return;
      }
      sendMessage();
    }
    function sendMessage() {
      const text = (inputEl.value || '').trim();
      if (!text || !ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ type: 'message', text }));
      inputEl.value = '';
      cmdActive = []; cmdIndex = -1; renderSuggestions();
      if (text.startsWith('/')) return;
      if (!agentRunning && !runHolding) {
        // Optimistic spinner bubble. Stage 0 stub; stage 2 shows thinking bubble.
      }
    }
    sendBtn.addEventListener('click', onSendClick);
    inputEl.addEventListener('keydown', (e) => {
      if (cmdActive.length > 0) {
        if (e.key === 'ArrowDown') { e.preventDefault(); cmdIndex = Math.min(cmdIndex + 1, cmdActive.length - 1); renderSuggestions(); return; }
        if (e.key === 'ArrowUp')   { e.preventDefault(); cmdIndex = Math.max(cmdIndex - 1, 0); renderSuggestions(); return; }
        if (e.key === 'Tab')       { e.preventDefault(); pickCmd(cmdIndex >= 0 ? cmdIndex : 0); return; }
        if (e.key === 'Escape')    { cmdActive = []; cmdIndex = -1; renderSuggestions(); return; }
        if (e.key === 'Enter' && !e.shiftKey && cmdIndex >= 0) { e.preventDefault(); pickCmd(cmdIndex); return; }
      }
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    inputEl.addEventListener('input', () => { updateSuggestions(); });

    // ───────────── Stage 3: Prompt dialog ─────────────
    function answer(value) {
      if (activePromptId === null) return;
      ws.send(JSON.stringify({ type: 'prompt_answer', id: activePromptId, value }));
      closePrompt();
    }
    function closePrompt() {
      activePromptId = null;
      if (promptCard.open) promptCard.open = false;
      promptInput.value = '';
      promptInput.style.display = 'none';
      promptRec.style.display = 'none';
      activeRecommended2 = '';
      activeActions = [];
      if (cancelArmTimer) { clearTimeout(cancelArmTimer); cancelArmTimer = null; }
      refreshComposer();
    }
    function makeBtn(label, cls, onClick) {
      const btn = document.createElement('m3e-button');
      btn.type = 'button';
      btn.textContent = label;
      btn.setAttribute('variant', cls === 'primary' ? 'filled' : cls === 'cancel' ? 'text' : 'tonal');
      if (cls === 'cancel') {
        btn.classList.add('cancel');
        btn.style.setProperty('--md-sys-color-primary', 'var(--md-sys-color-error)');
      }
      btn.addEventListener('click', onClick);
      return btn;
    }
    function makeCancelBtn() {
      const btn = makeBtn('Cancel task', 'cancel', null);
      let armed = false;
      btn.addEventListener('click', () => {
        if (armed) { answer(undefined); return; }
        armed = true;
        btn.classList.add('armed');
        btn.textContent = 'Tap again to cancel';
        if (cancelArmTimer) clearTimeout(cancelArmTimer);
        cancelArmTimer = setTimeout(() => {
          armed = false;
          btn.classList.remove('armed');
          btn.textContent = 'Cancel task';
          cancelArmTimer = null;
        }, 3000);
      });
      return btn;
    }
    function makeActionBtns() {
      const out = [];
      for (let i = 0; i < activeActions.length; i++) {
        const a = activeActions[i];
        out.push(makeBtn(a.label, 'secondary', () => answer(a.value)));
      }
      return out;
    }
    function renderButtons(buttons, stacked, omitCancel) {
      promptButtons.innerHTML = '';
      for (let i = 0; i < buttons.length; i++) promptButtons.appendChild(buttons[i]);
      const acts = makeActionBtns();
      for (let i = 0; i < acts.length; i++) promptButtons.appendChild(acts[i]);
      if (!omitCancel) promptButtons.appendChild(makeCancelBtn());

    }
    function showManualEntry() {
      promptRec.style.display = 'none';
      promptInput.style.display = 'block';
      promptInput.value = '';
      renderButtons([
        makeBtn('Submit', 'primary', () => answer(promptInput.value)),
        makeBtn('Back', 'secondary', showRecommendation)
      ]);
      promptInput.focus();
    }
    function showRecommendation() {
      promptInput.style.display = 'none';
      const buttons = [];
      if (activeRecommended2) {
        promptRec.style.display = 'none';
        buttons.push(makeBtn(activeRecommended, 'primary', () => answer(activeRecommended)));
        buttons.push(makeBtn(activeRecommended2, 'secondary', () => answer(activeRecommended2)));
        buttons.push(makeBtn('Manual answer', 'secondary', showManualEntry));
        renderButtons(buttons, true);
        return;
      }
      promptRec.style.display = 'block';
      buttons.push(makeBtn('Accept', 'primary', () => answer(activeRecommended)));
      buttons.push(makeBtn('Manual answer', 'secondary', showManualEntry));
      renderButtons(buttons);
    }
    function showPrompt(msg) {
      activePromptId = msg.id;
      promptQ.textContent = msg.question;
      activeRecommended = msg.recommended || '';
      activeRecommended2 = msg.recommended2 || '';
      activeActions = msg.actions || [];
      if (msg.dismissOnly) {
        promptInput.style.display = 'none';
        promptRec.style.display = 'block';
        setContent(promptRecText, msg.recommended || '');
        renderButtons([makeBtn('Close', 'primary', () => answer(''))], false, true);
      } else if (msg.recommended) {
        setContent(promptRecText, msg.recommended);
        showRecommendation();
      } else {
        promptRec.style.display = 'none';
        promptInput.style.display = 'block';
        promptInput.value = '';
        const buttons = [makeBtn('Submit', 'primary', () => answer(promptInput.value))];
        if (msg.allowSkip) buttons.push(makeBtn('Skip', 'secondary', () => answer('')));
        renderButtons(buttons);
        promptInput.focus();
      }
      promptCard.open = true;
      refreshComposer();
    }
    // Esc / programmatic close both land here — the prompt stays pending
    // server-side and is restored from the next snapshot.
    promptCard.addEventListener('closed', () => {
      if (activePromptId !== null) closePrompt();
    });

    // ───────────── WS ─────────────
    function connect() {
      const sock = new WebSocket(WS_URL_RESOLVED);
      ws = sock;
      sock.addEventListener('open', () => {
        if (ws !== sock) return;
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (reconnectAnim) { clearInterval(reconnectAnim); reconnectAnim = null; }
        overlay.classList.remove('show');
        reconnectDelay = 1000;
        connected = true;
        refreshComposer(); setSendBtn();
        if (notifyEnabled()) subscribePush().catch(() => {});
      });
      sock.addEventListener('message', (e) => {
        if (ws !== sock) return;
        try { handleMsg(JSON.parse(e.data)); } catch {}
      });
      sock.addEventListener('close', () => {
        if (ws !== sock) return;
        connected = false;
        refreshComposer();
        overlay.classList.add('show');
        const until = Date.now() + reconnectDelay;
        let frame = 0;
        const paint = () => {
          const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
          const glyph = SPIN[frame++ % SPIN.length];
          reconnectMsg.textContent = left > 0
            ? glyph + '  connection lost — retrying in ' + left + 's'
            : glyph + '  reconnecting…';
        };
        if (reconnectAnim) clearInterval(reconnectAnim);
        paint();
        reconnectAnim = setInterval(paint, 90);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
          connect();
        }, reconnectDelay);
      });
      sock.addEventListener('error', () => { try { sock.close(); } catch {} });
    }
    function connectNow() {
      if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      reconnectDelay = 1000;
      connect();
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) connectNow(); });
    window.addEventListener('online', connectNow);
    window.addEventListener('focus', connectNow);

    // ───────────── Message dispatch ─────────────
    function handleMsg(m) {
      switch (m.type) {
        case 'held':
          held = m.texts || [];
          runHolding = !!m.runActive;
          renderHeld();
          refreshComposer();
          break;
        case 'snapshot': {
          chatLog.innerHTML = '';
          closePrompt();
          currentThinking = null; thinkingText = '';
          currentBubble = null; streamText = '';
          for (const k in toolCallMap) delete toolCallMap[k];
          for (const t of (m.turns || [])) { try { renderTurn(t); } catch (e) {} }
          if (m.live) { try { renderLiveTurn(m.live); } catch (e) {} }
          taskWidgetLines = (m.taskWidget && m.taskWidget.length) ? m.taskWidget : null;
          taskWidgetData = m.taskWidgetData || null;
          renderWidgets();
          setModelName(m.model);
          if (m.context) setContextBar(m.context); else paintCtx(0);
          agentRunning = !!m.agentRunning;
          held = m.held || [];
          runHolding = !!m.heldRunActive;
          renderHeld();
          turnHadContent = !!(m.live && m.live.parts && m.live.parts.length);
          if (m.prompt) showPrompt(m.prompt);
          refreshComposer(); setSendBtn();
          break;
        }
        case 'models':
          modelCatalog = {current: m.current || null, models: m.models || []};
          // A switch changes the session model without a fresh agent run, so
          // the chip could keep the old name until the next message: re-sync
          // it from the catalogue whenever the current spec is known.
          {
            const cur = modelCatalog.models.find((x) => x.spec === modelCatalog.current);
            if (cur) setModelName(cur.name);
          }
          if (modelMenuOpen) renderModelMenu();
          break;
        case 'sessions':
          sessionData = {current: m.current || null, sessions: m.sessions || []};
          renderSessions();
          break;
        case 'agent_start':
          autoScroll = true;
          streamText = '';
          currentBubble = null;
          turnHadContent = false;
          agentRunning = true;
          setModelName(m.model);
          refreshComposer(); setSendBtn();
          break;
        case 'thinking_delta':
          turnHadContent = true;
          if (!currentThinking) {
            currentThinking = makeThinkingEl('', true);
            chatLog.appendChild(currentThinking);
            thinkingText = '';
            startSpin();
          }
          thinkingText += m.delta;
          currentThinking.querySelector('.thinking-body').textContent = thinkingText;
          currentThinking.querySelector('.thinking-label').textContent =
            thinkingSummary(thinkingLineCount(thinkingText));
          scrollBottom();
          break;
        case 'thinking_end':
          finalizeThinking();
          break;
        case 'text_delta':
          turnHadContent = true;
          if (!currentBubble) {
            finalizeThinking();
            // Same .msg row + shape avatar as every other assistant bubble —
            // a bare bubble renders with no avatar and full column width.
            const wrap = document.createElement('div');
            wrap.className = 'msg assistant';
            wrap.appendChild(makeAvatar('assistant'));
            currentBubble = document.createElement('div');
            currentBubble.className = 'bubble md';
            wrap.appendChild(currentBubble);
            chatLog.appendChild(wrap);
            streamText = '';
          }
          streamText += m.delta;
          currentBubble.textContent = streamText;
          scrollBottom();
          break;
        case 'text_end':
          if (currentBubble) {
            if (streamText) {
              mountMarkdown(currentBubble, streamText);
              attachBubbleCopy(currentBubble, streamText);
              /* Rendered markdown is usually taller than the streamed plain
                 text: re-jump so the final layout still sits at the bottom. */
              scrollBottom();
            }
            currentBubble = null; streamText = '';
          }
          break;
        case 'tool_start': {
          turnHadContent = true;
          finalizeThinking();
          const d = addToolCall(m.toolName, m.args, m.toolCallId, false);
          toolCallMap[m.toolCallId] = d;
          break;
        }
        case 'tool_end': {
          const d = toolCallMap[m.toolCallId];
          if (d) {
            if (m.isError) d.root.classList.add('error');
            appendElapsed(d, m.elapsedMs);
            const pre = document.createElement('pre');
            pre.className = 'tool-result';
            pre.textContent = toolResultText(m.result);
            d.body.appendChild(pre);
            delete toolCallMap[m.toolCallId];
          }
          currentBubble = null; streamText = '';
          break;
        }
        case 'user_message':
          addBubble('user', m.text);
          addTurnTime(Date.now(), 'user');
          break;
        case 'system_note':
          addSystemLine(m.text);
          addTurnTime(Date.now(), 'system');
          break;
        case 'agent_error':
          finalizeThinking();
          if (currentBubble) {
            if (streamText) {
              mountMarkdown(currentBubble, streamText);
              attachBubbleCopy(currentBubble, streamText);
            }
            currentBubble = null; streamText = '';
          }
          addBubble('error', m.message || 'Error');
          if (turnHadContent) addTurnTime(Date.now(), 'assistant');
          turnHadContent = false;
          agentRunning = false;
          refreshComposer(); setSendBtn();
          break;
        case 'agent_end':
          finalizeThinking();
          currentBubble = null; streamText = '';
          if (turnHadContent) addTurnTime(Date.now(), 'assistant');
          turnHadContent = false;
          agentRunning = false;
          setModelName(m.model);
          refreshComposer(); setSendBtn();
          setContextBar(m.contextUsage);
          break;
        case 'context':
          setContextBar(m.contextUsage);
          break;
        case 'prompt':
          showPrompt(m);
          break;
        case 'prompt_resolved':
          if (activePromptId === m.id) closePrompt();
          break;
        case 'widget':
          taskWidgetLines = (m.lines && m.lines.length) ? m.lines : null;
          taskWidgetData = m.data || null;
          renderWidgets();
          break;
        case 'notify':
          showToast(m.message, m.level);
          break;
        case 'reset':
          chatLog.innerHTML = '';
          finalizeThinking();
          currentBubble = null; streamText = '';
          turnHadContent = false;
          closePrompt();
          agentRunning = false;
          refreshComposer(); setSendBtn();
          taskWidgetLines = null; taskWidgetData = null;
          renderWidgets();
          paintCtx(0);
          break;
      }
    }

    // ───────────── Snapshot renderers ─────────────
    function renderTurn(t) {
      if (t.error) { addBubble('error', t.text); return; }
      if (t.role === 'system') { addSystemLine(t.text); addTurnTime(t.ts, 'system'); return; }
      if (t.role === 'user') { addBubble('user', t.text); addTurnTime(t.ts, 'user'); return; }
      for (const p of (t.parts || [])) {
        if (p.kind === 'text') {
          if (p.text) addBubble('assistant', p.text);
        } else if (p.kind === 'thinking') {
          if (p.text) makeThinkingEl(p.text, false);
        } else {
          renderToolPart(p);
        }
      }
      addTurnTime(t.ts, 'assistant');
    }
    function renderToolPart(p) {
      const d = addToolCall(p.toolName, p.args, p.toolCallId, p.isError);
      if (p.done) {
        appendElapsed(d, p.elapsedMs);
        const pre = document.createElement('pre');
        pre.className = 'tool-result';
        pre.textContent = toolResultText(p.result);
        d.body.appendChild(pre);
      } else {
        toolCallMap[p.toolCallId] = d;
      }
      return d;
    }
    function renderLiveTurn(live) {
      const parts = live.parts || [];
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const last = i === parts.length - 1;
        if (p.kind === 'text') {
          if (last && live.textOpen) {
            // Same structure as the delta path: an .msg row with the shape
            // avatar, not a bare bubble — a bare bubble renders with no
            // avatar and full column width.
            const wrap = document.createElement('div');
            wrap.className = 'msg assistant';
            wrap.appendChild(makeAvatar('assistant'));
            currentBubble = document.createElement('div');
            currentBubble.className = 'bubble md';
            if (p.text) currentBubble.textContent = p.text;
            streamText = p.text || '';
            wrap.appendChild(currentBubble);
            chatLog.appendChild(wrap);
            scrollBottom();
          } else if (p.text) {
            addBubble('assistant', p.text);
          }
        } else if (p.kind === 'thinking') {
          if (last && !p.done) {
            currentThinking = makeThinkingEl(p.text || '', true);
            thinkingText = p.text || '';
            startSpin();
          } else if (p.text) {
            makeThinkingEl(p.text, false);
          }
        } else {
          renderToolPart(p);
        }
      }
    }

    // ───────────── Mobile keyboard: track visual viewport ─────────────
    function setAppHeight() {
      const h = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
      document.documentElement.style.setProperty('--app-height', h + 'px');
    }
    setAppHeight();
    window.addEventListener('resize', setAppHeight);
    window.addEventListener('orientationchange', setAppHeight);


    setSendBtn();
    refreshComposer();
    connect();
`
}
