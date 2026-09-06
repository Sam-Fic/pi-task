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

const MDUI_VERSION = '2.1.5'
// Single pre-bundled entry. ~358 KB. Contains tslib, lit, all components,
// all helper functions. Self-contained — no bare specifiers.
const MDUI_BUNDLE = `https://cdn.jsdelivr.net/npm/mdui@${MDUI_VERSION}/mdui.esm.js`
const MDUI_CSS = `https://cdn.jsdelivr.net/npm/mdui@${MDUI_VERSION}/mdui.css`

// @mdui/icons 1.x — used only for the named Material glyphs that mdui
// itself does not register as <mdui-icon-*> web components. Stage 0
// renders icons via <mdui-icon name="..."> which mdui 2.x ships natively.
// @mdui/icons 1.x path kept for future stages that need per-icon components.
// Stage 0 uses mdui-icon name="..." which is resolved by mdui 2.x internally.
// const ICON_BASE = `https://unpkg.com/@mdui/icons@1.0.4`

// Stage 0 imports ONLY the bundle (and a few helper function imports from
// inside it). All <mdui-*> custom elements are registered automatically
// when the bundle executes.
const BUNDLE_IMPORTS = `
    import {
        setTheme,
        getTheme,
        snackbar,
    } from '${MDUI_BUNDLE}';
`

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
mdui-button, mdui-button-icon, mdui-fab, mdui-chip {
    transition: transform 350ms cubic-bezier(0.34, 1.56, 0.64, 1);
    transition: transform 350ms var(--m3e-spring-fast);
}
mdui-button:active, mdui-button-icon:active, mdui-fab:active {
    transform: scale(0.93);
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
}
html, body {
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: rgb(var(--mdui-color-surface));
    color: rgb(var(--mdui-color-on-surface));
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
#root {
    display: grid;
    grid-template-rows: auto 1fr auto auto auto;
    height: var(--app-height, 100dvh);
}

/* Content of the bottom bands aligns with the centered chat column
   without extra wrappers: at least 1rem, else centered-column + 1rem. */
:root {
    --col-pad: max(1rem, calc((100vw - var(--chat-max-width)) / 2 + 1rem));
}
#app-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: rgb(var(--mdui-color-surface-container));
    min-height: 3.5rem;
    box-sizing: border-box;
}
#app-bar-title {
    font-size: 1.45rem;
    font-weight: 650;
    font-family: ui-rounded, "SF Pro Rounded", "Segoe UI Variable Display", system-ui, sans-serif;
    letter-spacing: 0.01em;
    line-height: 1.75rem;
    color: rgb(var(--mdui-color-on-surface));
    flex: 1;
}
#theme-toggle {
    color: rgb(var(--mdui-color-on-surface-variant));
}
#status-bar {
    display: flex; align-items: center; gap: 0.75rem;
    padding: 0.5rem 1rem;
    background: rgb(var(--mdui-color-surface-container-low));
    font-size: 0.85rem;
    color: rgb(var(--mdui-color-on-surface-variant));
}
#status-bar .grow { flex: 1; }
#status-dot {
    width: 0.5rem; height: 0.5rem; border-radius: 50%;
    background: rgb(var(--mdui-color-outline));
    transition: background 0.2s;
}
#status-dot.connected.idle    { background: rgb(var(--mdui-color-tertiary)); }
#status-dot.connected.running { background: rgb(var(--mdui-color-primary));
    animation: pulse 1.4s ease-in-out infinite; }
#status-dot.disconnected      { background: rgb(var(--mdui-color-error)); }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
#ctx-bar { height: 4px;
    background: rgb(var(--mdui-color-surface-container-high)); overflow: hidden; }
#ctx-fill { height: 100%; width: 0%; border-radius: 0 999px 999px 0;
    background: linear-gradient(90deg,
        rgb(var(--mdui-color-tertiary)), rgb(var(--mdui-color-primary)), rgb(var(--mdui-color-error)));
    transition: width 0.3s; }
#chat-wrap { position: relative; min-height: 0; display: flex; }
#chat-log { flex: 1; min-width: 0; overflow-y: auto; overflow-x: hidden;
    padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
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
    padding: 0.75rem 1rem;
    border-radius: 1rem;
    background: rgb(var(--mdui-color-surface-container-high));
    color: rgb(var(--mdui-color-on-surface));
    line-height: 1.55;
    max-width: 80%;
    word-wrap: break-word;
}
.msg.user .bubble {
    background: rgb(var(--mdui-color-primary-container));
    color: rgb(var(--mdui-color-on-primary-container));
    border-top-right-radius: 0.5rem;
}
.msg.assistant .bubble { border-top-left-radius: 0.5rem; }

/* Markdown surface (Stage 1) */
.bubble.md {
    line-height: 1.55;
}
.bubble.md > :first-child { margin-top: 0; }
.bubble.md > :last-child  { margin-bottom: 0; }
.bubble.md h1, .bubble.md h2, .bubble.md h3, .bubble.md h4, .bubble.md h5, .bubble.md h6 {
    margin: 0.8em 0 0.4em;
    font-weight: 600;
    line-height: 1.25;
}
.bubble.md h1 { font-size: 1.4em; }
.bubble.md h2 { font-size: 1.2em; }
.bubble.md h3 { font-size: 1.05em; }
.bubble.md p  { margin: 0.5em 0; }
.bubble.md ul, .bubble.md ol { margin: 0.5em 0; padding-left: 1.5em; }
.bubble.md li { margin: 0.2em 0; }
.bubble.md blockquote {
    margin: 0.6em 0;
    padding: 0.2em 0.8em;
    border-left: 3px solid rgb(var(--mdui-color-outline-variant));
    color: rgb(var(--mdui-color-on-surface-variant));
}
.bubble.md a { color: rgb(var(--mdui-color-primary)); text-decoration: none; }
.bubble.md a:hover { text-decoration: underline; }
.bubble.md strong { font-weight: 600; }
.bubble.md em { font-style: italic; }
.bubble.md code {
    background: rgb(var(--mdui-color-surface-container-highest));
    color: rgb(var(--mdui-color-on-surface));
    padding: 0.1em 0.4em;
    border-radius: 0.25rem;
    font-family: Consolas, Menlo, "Courier New", monospace;
    font-size: 0.9em;
}
/* Code block. Language + copy float as a pill over the top-right corner
   instead of a full-width header bar, so the code surface stays clean.
   Concentric radii with the pill: block radius = pill half-height (1rem of
   the 2rem pill) + pill inset (shape-corner-extra-small), so both arcs
   share a center. */
.bubble .code-block {
    position: relative;
    --_pill-inset: var(--mdui-shape-corner-extra-small);
    background: rgb(var(--mdui-color-surface-container-lowest));
    border-radius: calc(1rem + var(--_pill-inset));
    overflow: hidden;
    margin: 0.6em 0;
    font-size: 0.9em;
}
.bubble .code-head {
    position: absolute;
    top: var(--_pill-inset);
    right: var(--_pill-inset);
    height: 2rem;
    box-sizing: border-box;
    z-index: 1;
    display: flex; align-items: center; gap: 0.15rem;
    background: rgb(var(--mdui-color-surface-container));
    box-shadow: var(--mdui-elevation-level1);
    border-radius: 999px;
    padding: 0.1rem 0.2rem 0.1rem 0.65rem;
    opacity: 0;
    transition: opacity 0.15s;
}
.bubble .code-block:hover .code-head { opacity: 1; }
/* Touch devices have no hover — keep the pill faintly visible and icon-only
   so it never covers the code. */
@media (hover: none) {
    .bubble .code-head { opacity: 0.75; }
    .bubble .code-head .code-lang { display: none; }
}
.bubble .code-lang {
    color: rgb(var(--mdui-color-on-surface-variant));
    font-family: Consolas, Menlo, "Courier New", monospace;
    font-size: 0.7rem; letter-spacing: 0.05em;
    /* kill the inherited 1.55 strut: its asymmetric half-leading rode the
       text optically high next to the 16px icon line box */
    line-height: 1;
    display: flex; align-items: center;
}
.bubble .code-head .copy-btn {
    font-size: 1rem;
    width: 1.7rem; height: 1.7rem;
    color: rgb(var(--mdui-color-on-surface-variant));
}
.bubble .code-block pre {
    margin: 0;
    border-radius: 0;
}
.bubble.md pre {
    background: rgb(var(--mdui-color-surface-container-lowest));
    color: rgb(var(--mdui-color-on-surface));
    padding: 0.75em 1em;
    border-radius: var(--mdui-shape-corner-small);
    overflow-x: auto;
    margin: 0.6em 0;
    line-height: 1.4;
}
.bubble.md pre code {
    background: transparent; padding: 0;
    font-size: 0.85em;
}
.bubble.md table {
    border-collapse: collapse;
    margin: 0.6em 0;
    font-size: 0.9em;
    overflow: hidden;
    border-radius: var(--mdui-shape-corner-small);
}
.bubble.md th, .bubble.md td {
    border: none;
    border-bottom: 1px solid rgb(var(--mdui-color-outline-variant));
    padding: 0.4em 0.7em;
    text-align: left;
}
.bubble.md tr:last-child td { border-bottom: none; }
.bubble.md th { background: rgb(var(--mdui-color-surface-container)); font-weight: 600; }
.bubble.md hr {
    border: 0;
    border-top: 1px solid rgb(var(--mdui-color-outline-variant));
    margin: 1em 0;
}

/* Thinking (Stage 2, mdui-collapse) */
mdui-collapse.thinking {
    display: block;
    max-width: var(--chat-max-width);
    width: 100%;
    margin: 0.25rem auto;
    border-radius: var(--mdui-shape-corner-medium);
    background: rgb(var(--mdui-color-surface-container-low));
    overflow: hidden;
    transition: border-radius 350ms cubic-bezier(0.34, 1.56, 0.64, 1);
    transition: border-radius 350ms var(--m3e-spring-fast);
}
mdui-collapse.thinking[value] { border-radius: 1.125rem; }
.thinking .thinking-header {
    cursor: pointer;
    padding: 0.5rem 0.85rem;
    font-size: 0.85rem;
    color: rgb(var(--mdui-color-on-surface-variant));
    font-weight: 500;
    user-select: none;
    border-radius: var(--mdui-shape-corner-medium);
}
.thinking .thinking-header::before {
    content: '›';
    display: inline-block;
    margin-right: 0.4em;
    transition: transform 0.15s;
    color: rgb(var(--mdui-color-on-surface-variant));
}
mdui-collapse.thinking[value] .thinking-header::before { transform: rotate(90deg); }
.thinking-body {
    margin: 0;
    padding: 0.5rem 1rem 0.85rem;
    font-family: Consolas, Menlo, "Courier New", monospace;
    font-size: 0.82rem;
    line-height: 1.5;
    color: rgb(var(--mdui-color-on-surface-variant));
    white-space: pre-wrap;
    word-wrap: break-word;
    max-height: 16rem;
    overflow-y: auto;
}

/* Tool-call (Stage 2, mdui-collapse) */
mdui-collapse.tool-call {
    display: block;
    max-width: var(--chat-max-width);
    width: 100%;
    margin: 0.3rem auto;
    border-radius: var(--mdui-shape-corner-medium);
    background: rgb(var(--mdui-color-surface-container));
    overflow: hidden;
    transition: border-radius 350ms cubic-bezier(0.34, 1.56, 0.64, 1);
    transition: border-radius 350ms var(--m3e-spring-fast);
}
mdui-collapse.tool-call[value] { border-radius: 1.125rem; }
mdui-collapse.tool-call.error {
    background: color-mix(in srgb, rgb(var(--mdui-color-error-container)) 35%, rgb(var(--mdui-color-surface-container)));
}
.tool-call .tool-header {
    cursor: pointer;
    padding: 0.6rem 0.85rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    user-select: none;
    border-radius: var(--mdui-shape-corner-medium);
}
.tool-call .tool-header::before {
    content: '›';
    display: inline-block;
    transition: transform 0.15s;
    color: rgb(var(--mdui-color-on-surface-variant));
    flex-shrink: 0;
}
mdui-collapse.tool-call[value] .tool-header::before { transform: rotate(90deg); }
.tool-label {
    flex: 1;
    font-family: Consolas, Menlo, "Courier New", monospace;
    font-size: 0.85rem;
    color: rgb(var(--mdui-color-on-surface));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
}
.tool-badge {
    flex-shrink: 0;
    font-family: Consolas, Menlo, "Courier New", monospace;
    font-size: 0.75rem;
    padding: 0.1rem 0.4rem;
    border-radius: var(--mdui-shape-corner-extra-small);
    background: rgb(var(--mdui-color-tertiary-container));
    color: rgb(var(--mdui-color-on-tertiary-container));
}
.tool-elapsed {
    flex-shrink: 0;
    font-size: 0.75rem;
    color: rgb(var(--mdui-color-on-surface-variant));
}
.tool-diff {
    padding: 0.4rem 0.85rem 0.4rem;
    background: rgb(var(--mdui-color-surface-container-lowest));
    font-family: Consolas, Menlo, "Courier New", monospace;
    font-size: 0.82rem;
    line-height: 1.45;
    overflow-x: auto;
    max-height: 14rem;
    overflow-y: auto;
}
.tool-result {
    margin: 0;
    padding: 0.5rem 0.85rem;
    background: rgb(var(--mdui-color-surface-container-lowest));
    font-family: Consolas, Menlo, "Courier New", monospace;
    font-size: 0.82rem;
    line-height: 1.45;
    white-space: pre-wrap;
    word-wrap: break-word;
    max-height: 18rem;
    overflow: auto;
    color: rgb(var(--mdui-color-on-surface-variant));
}
.avatar {
    width: 2.25rem; height: 2.25rem; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.15rem; flex-shrink: 0;
}
.avatar.user      { background: rgb(var(--mdui-color-primary));
    color: rgb(var(--mdui-color-on-primary)); }
.avatar.assistant { background: rgb(var(--mdui-color-secondary-container));
    color: rgb(var(--mdui-color-on-secondary-container)); }
.avatar.error     { background: rgb(var(--mdui-color-error-container));
    color: rgb(var(--mdui-color-on-error-container)); }
#input-bar {
    display: flex; gap: 0.5rem; align-items: flex-end;
    padding: 0.75rem var(--col-pad) 1rem;
    background: rgb(var(--mdui-color-surface-container));
    width: 100%;
    box-sizing: border-box;
}
#input { flex: 1; min-width: 0; }
/* Expressive send button: tonal circle; send<->stop swings 90deg on the
   spring token, and the running/armed states bridge the tonal color tokens
   to the error palette. */
mdui-button-icon#send-btn {
    transform: rotate(var(--send-rot, 0deg));
}
mdui-button-icon#send-btn:active {
    transform: rotate(var(--send-rot, 0deg)) scale(0.93);
}
mdui-button-icon#send-btn.running {
    --send-rot: 90deg;
    --mdui-color-secondary-container: var(--mdui-color-error-container);
    --mdui-color-on-secondary-container: var(--mdui-color-on-error-container);
}
mdui-button-icon#send-btn.armed {
    --mdui-color-secondary-container: var(--mdui-color-error);
    --mdui-color-on-secondary-container: var(--mdui-color-on-error);
}
#reconnect-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.6);
    color: white; font-weight: 500;
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
    background: rgb(var(--mdui-color-tertiary-container));
    color: rgb(var(--mdui-color-on-tertiary-container));
    width: 100%;
    box-sizing: border-box;
    font-size: 0.85rem;
}
#held-bar #held-label { font-weight: 600; }
#held-bar #held-text {
    flex: 1; font-style: italic;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
#held-clear {
    color: rgb(var(--mdui-color-on-tertiary-container));
}

mdui-card#status-panel {
    display: none;
    box-sizing: border-box;
    width: 100%;
    padding: 0.6rem var(--col-pad);
    border-radius: 0;
    font-size: 0.85rem;
    color: rgb(var(--mdui-color-on-surface));
}
#status-panel.structured .widget-title { font-weight: 600; margin-bottom: 0.3rem; }
#status-panel.structured .widget-meta {
    display: flex; gap: 0.6rem; align-items: center;
    color: rgb(var(--mdui-color-on-surface-variant));
    font-size: 0.78rem; margin-bottom: 0.4rem;
}
#status-panel .widget-phase { font-size: 0.78rem; }
/* Wavy determinate indicator — the M3 Expressive signature — rendered by
   @m3e/web's <m3e-linear-progress-indicator variant="wavy"> (loaded from
   esm.sh; mdui 2.x has no Expressive components). Its color tokens are
   bridged to the mdui theme so light/dark follow the same palette. */
#status-panel m3e-linear-progress-indicator.widget-bar {
    display: block;
    width: 100%;
    margin: 0.15rem 0 0.3rem;
    --md-sys-color-primary: rgb(var(--mdui-color-primary));
    --md-sys-color-secondary-container: rgb(var(--mdui-color-surface-container-highest));
    --md-sys-color-on-surface-variant: rgb(var(--mdui-color-on-surface-variant));
}
@media (prefers-reduced-motion: reduce) {
    mdui-button, mdui-button-icon, mdui-fab, mdui-chip { transition: none; }
    mdui-button:active, mdui-button-icon:active, mdui-fab:active { transform: none; }
}
#status-panel.structured .widget-action {
    font-family: Consolas, Menlo, monospace; font-size: 0.78rem;
    color: rgb(var(--mdui-color-on-surface-variant));
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Bell + notif dropdown */
mdui-button-icon#bell {
    position: fixed;
    top: calc(env(safe-area-inset-top, 0px) + 0.5rem);
    right: 4.5rem; z-index: 50;
    color: rgb(var(--mdui-color-on-surface));
}
mdui-button-icon#bell.on { color: rgb(var(--mdui-color-primary)); }
#notif-panel {
    position: fixed; top: 3.5rem; right: 1rem;
    width: 320px; max-height: 60vh;
    background: rgb(var(--mdui-color-surface-container-high));
    border-radius: var(--mdui-shape-corner-medium);
    box-shadow: var(--mdui-elevation-level3);
    padding: 0.5rem;
    display: none;
    flex-direction: column; gap: 0.4rem;
    z-index: 60;
    overflow: hidden;
}
#notif-panel.open { display: flex; }
#notif-toggle-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.4rem 0.6rem;
}
#notif-title { font-weight: 600; font-size: 0.9rem; }

mdui-list#notif-list {
    overflow-y: auto; flex: 1;
    font-size: 0.85rem;
    padding: 0;
    background: transparent;
}
.notif-item { word-wrap: break-word; white-space: normal; }
.notif-item.warning, .notif-item.error { color: rgb(var(--mdui-color-error)); }
#notif-empty {
    padding: 1rem;
    color: rgb(var(--mdui-color-on-surface-variant));
    text-align: center;
    font-size: 0.85rem;
}

/* Cmd suggestions (above input) */
#cmd-suggestions {
    position: absolute;
    bottom: 100%;
    left: var(--col-pad); right: var(--col-pad);
    margin-bottom: 0.25rem;
    background: rgb(var(--mdui-color-surface-container-high));
    border-radius: var(--mdui-shape-corner-medium);
    box-shadow: var(--mdui-elevation-level2);
    overflow: hidden;
    display: none;
    max-height: 14rem;
    overflow-y: auto;
}
#cmd-suggestions mdui-list { padding: 0; }
#cmd-suggestions mdui-list-item {
    cursor: pointer;
    font-size: 0.9rem;
}

/* Scroll-to-bottom (mdui-fab) */
mdui-fab#scroll-bottom {
    position: absolute;
    bottom: 1rem; right: var(--col-pad);
    transform: scale(0) rotate(-90deg);
    opacity: 0;
    pointer-events: none;
    transition: transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease;
    transition: transform 400ms var(--m3e-spring-spatial), opacity 200ms ease;
}
mdui-fab#scroll-bottom.show {
    transform: scale(1) rotate(0deg);
    opacity: 1;
    pointer-events: auto;
}
mdui-fab#scroll-bottom.show:active { transform: scale(0.9) rotate(0deg); }

/* Turn-time divider */
.turn-time {
    max-width: var(--chat-max-width);
    width: 100%; margin: 0.4rem auto;
    text-align: center;
    font-size: 0.7rem;
    color: rgb(var(--mdui-color-on-surface-variant));
    font-family: Consolas, Menlo, monospace;
}
.turn-time.assistant { color: rgb(var(--mdui-color-on-surface-variant)); }
.turn-time.user { color: rgb(var(--mdui-color-primary)); }
.turn-time.system { color: rgb(var(--mdui-color-on-surface-variant)); }

/* System note (centered, muted) */
.sysnote {
    max-width: var(--chat-max-width);
    width: 100%; margin: 0.4rem auto;
    text-align: center;
    font-size: 0.78rem;
    color: rgb(var(--mdui-color-on-surface-variant));
    background: rgb(var(--mdui-color-surface-container));
    border-radius: var(--mdui-shape-corner-extra-small);
    padding: 0.25rem 0.6rem;
    box-sizing: border-box;
}

/* Copy buttons: the code-block one sits in its header bar (rendered by the
   markdown module); the message one floats on finished assistant bubbles. */
.copy-btn { font-size: 1.1rem; }
.copy-btn.copied { color: rgb(var(--mdui-color-primary)); }
.bubble-copy {
    position: absolute;
    top: 0.15rem; right: 0.15rem;
    width: 2rem; height: 2rem;
    background: rgb(var(--mdui-color-surface-container-high));
    border-radius: 999px;
    opacity: 0;
    transition: opacity 0.15s;
}
.msg.assistant:hover .bubble-copy { opacity: 1; }
/* Touch devices have no hover — keep the button faintly visible. */
@media (hover: none) { .bubble-copy { opacity: 0.55; } }

/* Prompt dialog (mdui-dialog).
   Concentric radii: dialog body padding 24px, dialog corner 28px
   -> inner elements sit 4px inside their container -> shape-corner-small. */
#prompt-card { --mdui-shape-corner: var(--mdui-shape-corner-extra-large); }
#prompt-card .q { font-size: 0.95rem; line-height: 1.5; }
#prompt-card .rec-panel {
    display: none;
    margin-top: 0.85rem;
    background: rgb(var(--mdui-color-secondary-container));
    color: rgb(var(--mdui-color-on-secondary-container));
    padding: 0.75rem;
    border-radius: var(--mdui-shape-corner-small);
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
#prompt-buttons mdui-button.cancel { font-size: 0.85rem; }
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
  <link rel="stylesheet" href="${MDUI_CSS}">
  <link rel="modulepreload" href="${MDUI_BUNDLE}" crossorigin="anonymous">
  <style>${CSS}</style>
</head>
<body>
  <div id="root">
    <header>
      <div id="app-bar">
        <span id="app-bar-title">π-task remote</span>
        <span class="grow"></span>
        <mdui-button-icon id="theme-toggle" aria-label="切换主题"></mdui-button-icon>
      </div>
      <div id="status-bar">
        <span id="status-dot"></span>
        <span id="status-model" style="display:none"></span>
        <span id="status-ctx"></span>
        <span class="grow"></span>
        <mdui-chip id="status-chip" variant="filled">disconnected</mdui-chip>
      </div>
      <div id="ctx-bar"><div id="ctx-fill"></div></div>
    </header>

    <main id="chat-wrap">
      <div id="chat-log"></div>
      <mdui-fab id="scroll-bottom" icon="arrow_downward" size="small" aria-label="跳到底部" title="跳到底部"></mdui-fab>
    </main>

    <!-- Status panel: shows structured task progress (phase / step / elapsed) -->
    <mdui-card id="status-panel" variant="filled" style="display:none"></mdui-card>

    <!-- Held input: lines typed while a task run owns the session -->
    <div id="held-bar" style="display:none">
      <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 20a8 8 0 1 0-8-8 8 8 0 0 0 8 8zm0-18a10 10 0 1 1-10 10A10 10 0 0 1 12 2zm.5 5v5.25l4.5 2.67-.75 1.23L11 13V7z"/></svg>
      <span id="held-label">waiting:</span>
      <span id="held-text"></span>
      <mdui-button-icon id="held-clear" icon="close" title="清除"></mdui-button-icon>
    </div>

    <footer id="input-bar" style="position:relative;">
      <div id="cmd-suggestions"></div>
      <mdui-text-field id="input" variant="filled" autosize min-rows="1" max-rows="6"
        placeholder="输入消息（/ 查看命令）…" disabled></mdui-text-field>
      <mdui-button-icon id="send-btn" variant="tonal" icon="send" disabled aria-label="发送"></mdui-button-icon>
    </footer>
  </div>

  <!-- Bell + notifications dropdown -->
  <mdui-button-icon id="bell" icon="notifications" aria-label="通知"></mdui-button-icon>
  <div id="notif-panel" aria-hidden="true">
    <div id="notif-toggle-row">
      <span id="notif-title">通知</span>
      <mdui-switch id="notif-toggle"></mdui-switch>
    </div>
    <mdui-list id="notif-list"></mdui-list>
  </div>

  <!-- Prompt dialog: shown when pi asks for user input -->
  <mdui-dialog id="prompt-card" close-on-esc headline="π 需要你的输入">
    <div slot="description" class="q" id="prompt-q"></div>
    <div class="rec-panel" id="prompt-rec">
      <div class="rec-label">推荐答案</div>
      <div class="rec-text" id="prompt-rec-text"></div>
    </div>
    <mdui-text-field id="prompt-input" variant="filled" autosize min-rows="3" max-rows="8"
      placeholder="输入你的回答…" style="display:none"></mdui-text-field>
    <div slot="action" class="row" id="prompt-buttons"></div>
  </mdui-dialog>

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
    const inputEl      = document.getElementById('input');
    const sendBtn      = document.getElementById('send-btn');
    const ctxFill      = document.getElementById('ctx-fill');
    const statusDot    = document.getElementById('status-dot');
    const statusModel  = document.getElementById('status-model');
    const statusCtx    = document.getElementById('status-ctx');
    const statusChip   = document.getElementById('status-chip');
    const overlay      = document.getElementById('reconnect-overlay');
    const reconnectMsg = document.getElementById('reconnect-msg');
    const themeBtn     = document.getElementById('theme-toggle');
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
    const bell         = document.getElementById('bell');
    const notifPanel   = document.getElementById('notif-panel');
    const notifList    = document.getElementById('notif-list');
    const notifToggle  = document.getElementById('notif-toggle');
    const notifTitle   = document.getElementById('notif-title');

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

    // M3 Expressive wavy progress (mdui 2.x has no Expressive components yet).
    // Pinned version; loaded async so a slow CDN never blocks the app boot.
    import('https://esm.sh/@m3e/web@2.7.9/progress-indicator').catch(() => {});

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

    // ───────────── Theme ─────────────
    const ICON_SUN  = '<path fill="currentColor" d="M12 18V6a6 6 0 0 0 0 12zm0-16a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0V3a1 1 0 0 1 1-1zm0 16a1 1 0 0 1 1 1v1a1 1 0 0 1-2 0v-1a1 1 0 0 1 1-1zM4.22 4.22a1 1 0 0 1 1.41 0l.71.71a1 1 0 1 1-1.41 1.41l-.71-.71a1 1 0 0 1 0-1.41zm13.44 13.44a1 1 0 0 1 1.41 0l.71.71a1 1 0 1 1-1.41 1.41l-.71-.71a1 1 0 0 1 0-1.41zM2 12a1 1 0 0 1 1-1h1a1 1 0 0 1 0 2H3a1 1 0 0 1-1-1zm17 0a1 1 0 0 1 1-1h1a1 1 0 0 1 0 2h-1a1 1 0 0 1-1-1zM4.22 19.78a1 1 0 0 1 0-1.41l.71-.71a1 1 0 1 1 1.41 1.41l-.71.71a1 1 0 0 1-1.41 0zm13.44-13.44a1 1 0 0 1 0-1.41l.71-.71a1 1 0 1 1 1.41 1.41l-.71.71a1 1 0 0 1-1.41 0z"/>';
    const ICON_MOON = '<path fill="currentColor" d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.39 5.39 0 0 1-4.4 2.26 5.4 5.4 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>';
    const ICON_AUTO = '<path fill="currentColor" d="M12 22a10 10 0 1 1 10-10 10 10 0 0 1-10 10zm0-2a8 8 0 0 0 0-16z"/>';
    function paintThemeIcon(t) {
      themeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20">'
        + (t === 'light' ? ICON_MOON
        : t === 'dark'  ? ICON_AUTO
        :                 ICON_SUN)
        + '</svg>';
    }
    const stored = localStorage.getItem('pi-task-theme') || 'auto';
    setTheme(stored);
    paintThemeIcon(stored);
    themeBtn.addEventListener('click', () => {
      const cur = getTheme();
      const next = cur === 'light' ? 'dark' : cur === 'dark' ? 'auto' : 'light';
      setTheme(next);
      localStorage.setItem('pi-task-theme', next);
      paintThemeIcon(next);
    });

    // ───────────── Status ─────────────
    function fmtTokens(n) {
      if (n == null) return '';
      if (n < 1000) return String(n);
      if (n < 10000) return (n / 1000).toFixed(1) + 'k';
      if (n < 1000000) return Math.round(n / 1000) + 'k';
      return (n / 1000000).toFixed(1) + 'M';
    }
    function setContextBar(usage) {
      if (usage && usage.percent != null) ctxFill.style.width = usage.percent + '%';
      if (!usage) return;
      const parts = [];
      if (usage.percent != null) parts.push(Math.round(usage.percent) + '%');
      if (usage.tokens != null && usage.contextWindow) {
        parts.push(fmtTokens(usage.tokens) + '/' + fmtTokens(usage.contextWindow));
      }
      statusCtx.textContent = parts.join(' · ');
    }
    function setModelName(name) {
      if (name === undefined || name === modelName) return;
      modelName = name || '';
      statusModel.textContent = modelName;
      statusModel.style.display = modelName ? '' : 'none';
    }
    function updateStatusDot() {
      statusDot.className = !connected ? 'disconnected'
                          : agentRunning ? 'connected running'
                          :                 'connected idle';
      statusChip.textContent = !connected ? 'disconnected'
                             : agentRunning ? 'running'
                             :                 'idle';
    }
    function setSendBtn() {
      sendBtn.classList.toggle('running', agentRunning);
      sendBtn.icon = agentRunning ? 'stop' : 'send';
    }

    // ───────────── Scroll tracking ─────────────
    function atBottom() {
      return chatLog.scrollTop + chatLog.clientHeight >= chatLog.scrollHeight - 24;
    }
    function scrollBottom() {
      if (autoScroll) chatLog.scrollTop = chatLog.scrollHeight;
      scrollBtn.classList.toggle('show', !atBottom());
    }
    chatLog.addEventListener('scroll', () => {
      autoScroll = atBottom();
      scrollBtn.classList.toggle('show', !autoScroll);
    });
    scrollBtn.addEventListener('click', () => {
      autoScroll = true;
      chatLog.scrollTop = chatLog.scrollHeight;
      scrollBtn.classList.remove('show');
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
        const icon = document.createElement('mdui-button-icon');
        icon.type = 'button';
        icon.className = 'copy-btn';
        icon.icon = 'content_copy';
        icon.setAttribute('aria-label', '复制代码');
        b.replaceWith(icon);
      });
    }
    function addBubble(role, text) {
      const wrap = document.createElement('div');
      wrap.className = 'msg ' + role;
      const avatar = document.createElement('div');
      avatar.className = 'avatar ' + role;
      avatar.innerHTML = role === 'user'
        ? '<mdui-icon name="person"></mdui-icon>'
        : role === 'error'
          ? '<mdui-icon name="error_outline"></mdui-icon>'
          : '<mdui-icon name="auto_awesome"></mdui-icon>';
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
        const av = document.createElement('div');
        av.className = 'avatar assistant';
        av.innerHTML = '<mdui-icon name="auto_awesome"></mdui-icon>';
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
      const b = document.createElement('mdui-button-icon');
      b.type = 'button';
      b.className = 'copy-btn bubble-copy';
      b.icon = 'content_copy';
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
      btn.icon = 'check';
      btn.classList.add('copied');
      setTimeout(() => { btn.icon = 'content_copy'; btn.classList.remove('copied'); }, 1200);
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
      return '✻ Thinking… (' + n + (n === 1 ? ' line' : ' lines') + ')';
    }
    function thinkingLineCount(text) {
      return text ? text.split('\\n').length : 0;
    }
    function makeThinkingEl(text, live) {
      const wrap = document.createElement('mdui-collapse');
      wrap.className = 'thinking';
      const item = document.createElement('mdui-collapse-item');
      item.value = 'thinking';
      const header = document.createElement('div');
      header.setAttribute('slot', 'header');
      header.className = 'thinking-header';
      const lbl = document.createElement('span');
      lbl.className = 'thinking-label';
      lbl.textContent = thinkingSummary(thinkingLineCount(text));
      header.appendChild(lbl);
      item.appendChild(header);
      const body = document.createElement('pre');
      body.className = 'thinking-body';
      body.textContent = text || '';
      item.appendChild(body);
      wrap.appendChild(item);
      if (live || !text) wrap.setAttribute('value', 'thinking');
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
        currentThinking = null; thinkingText = '';
        stopSpinIfIdle();
      } else {
        thinkingText = '';
      }
    }

    // ───────────── Stage 2: Tool call cards ─────────────
    // Returns a small facade {root, header, body} over the mdui-collapse
    // structure so call sites can append results/elapsed without knowing it.
    function addToolCall(toolName, args, toolCallId, isError) {
      const wrap = document.createElement('mdui-collapse');
      wrap.className = 'tool-call' + (isError ? ' error' : '');
      wrap.id = 'tool-' + toolCallId;
      const item = document.createElement('mdui-collapse-item');
      item.value = 'tool';
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
      item.appendChild(header);
      const body = document.createElement('div');
      body.className = 'tool-body';
      const diffHtml = toolDiffHtml(toolName, args);
      if (diffHtml) {
        const dv = document.createElement('div');
        dv.className = 'tool-diff';
        dv.innerHTML = diffHtml;
        body.appendChild(dv);
      }
      item.appendChild(body);
      wrap.appendChild(item);
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
          + (d.phase ? '<mdui-chip class="widget-phase">' + escHtml(d.phase) + '</mdui-chip>' : '')
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
      snackbar({
        message: prefix + message,
        placement: 'top',
        closeable: true,
        autoCloseDelay: 4000,
      });
      recordNotif(message, level);
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
        html += '<mdui-list-item class="notif-item ' + escHtml(n.level) + '"'
          + ' icon="' + (LEVEL_ICON[n.level] || 'info') + '"'
          + ' headline="' + escHtml(n.message) + '"'
          + ' description="' + escHtml(fmtClock(n.ts)) + '" nonclickable></mdui-list-item>';
      }
      notifList.innerHTML = html;
    }

    // ───────────── Stage 3: Bell + push ─────────────
    const NOTIFY_KEY = 'piRemoteNotify';
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
      bell.classList.toggle('on', on);
      notifToggle.checked = on;
    }
    function setNotifOpen(open) {
      notifOpen = open;
      notifPanel.classList.toggle('open', open);
      notifPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
      if (open) { renderNotifList(); updateBell(); }
    }
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
    bell.addEventListener('click', (e) => {
      e.stopPropagation();
      setNotifOpen(!notifOpen);
    });
    document.addEventListener('click', (e) => {
      if (notifOpen && !notifPanel.contains(e.target) && e.target !== bell) {
        setNotifOpen(false);
      }
    });
    notifToggle.addEventListener('change', togglePush);
    updateBell();

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
      const list = document.createElement('mdui-list');
      cmdActive.forEach((cmd, i) => {
        const el = document.createElement('mdui-list-item');
        if (i === cmdIndex) el.setAttribute('active', '');
        el.setAttribute('headline', cmd.name);
        el.setAttribute('description', cmd.desc);
        el.addEventListener('mousedown', (e) => { e.preventDefault(); pickCmd(i); });
        list.appendChild(el);
      });
      cmdSuggestions.appendChild(list);
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
      const btn = document.createElement('mdui-button');
      btn.type = 'button';
      btn.textContent = label;
      btn.setAttribute('variant', cls === 'primary' ? 'filled' : cls === 'cancel' ? 'text' : 'tonal');
      if (cls === 'cancel') {
        btn.classList.add('cancel');
        btn.style.setProperty('--mdui-color-primary', 'var(--mdui-color-error)');
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
      promptCard.stackedActions = !!stacked;
    }
    function showManualEntry() {
      promptRec.style.display = 'none';
      promptInput.style.display = 'block';
      promptInput.value = '';
      renderButtons([
        makeBtn('Submit', 'primary', () => answer(promptInput.value)),
        makeBtn('← Back', 'secondary', showRecommendation)
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
        buttons.push(makeBtn('✎ Manual answer', 'secondary', showManualEntry));
        renderButtons(buttons, true);
        return;
      }
      promptRec.style.display = 'block';
      buttons.push(makeBtn('✓ Accept', 'primary', () => answer(activeRecommended)));
      buttons.push(makeBtn('✎ Manual answer', 'secondary', showManualEntry));
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
    promptCard.addEventListener('close', () => {
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
          if (m.context) setContextBar(m.context); else ctxFill.style.width = '0%';
          agentRunning = !!m.agentRunning;
          held = m.held || [];
          runHolding = !!m.heldRunActive;
          renderHeld();
          turnHadContent = !!(m.live && m.live.parts && m.live.parts.length);
          if (m.prompt) showPrompt(m.prompt);
          refreshComposer(); setSendBtn();
          break;
        }
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
            currentBubble = document.createElement('div');
            currentBubble.className = 'bubble md';
            chatLog.appendChild(currentBubble);
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
          ctxFill.style.width = '0%';
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
            currentBubble = document.createElement('div');
            currentBubble.className = 'bubble md';
            if (p.text) currentBubble.textContent = p.text;
            streamText = p.text || '';
            chatLog.appendChild(currentBubble);
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
