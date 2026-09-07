import {describe, it, expect} from 'bun:test'
import {mduiHtml} from '../../src/remote/ui-mdui.js'

/** The MD UI is one inline `<script type="module">`; the only module syntax in
 *  it is the CDN imports at the top, so stripping those leaves a body that
 *  `new Function` can parse. A syntax error anywhere kills the whole script,
 *  leaving the client stuck at "connecting…". */
function clientScript(out: string): string {
    const m = out.match(/<script type="module">([\s\S]*?)<\/script>/)
    expect(m).not.toBeNull()
    return m![1].replace(/import[\s\S]*?from '[^']*';/, '')
}

describe('mduiHtml()', () => {
    it('returns a string', () => {
        expect(typeof mduiHtml('ws://localhost:7600/ws')).toBe('string')
    })

    it('embeds the wsUrl as a fallback in the output', () => {
        const out = mduiHtml('ws://192.168.1.5:7601/ws')
        expect(out).toContain('ws://192.168.1.5:7601/ws')
    })

    it('derives the WebSocket URL from the page origin so LAN and Tailscale URLs both connect', () => {
        const out = mduiHtml('ws://192.168.1.5:7601/ws')
        // WS must follow whatever host served the page, not a baked-in IP.
        expect(out).toContain('location.host')
        expect(out).toContain("'wss://'")
        expect(out).toContain("'ws://'")
    })

    it('contains required DOM element ids', () => {
        const out = mduiHtml('ws://localhost:7600/ws')
        for (const id of [
            'chat-log',
            'input',
            'send-btn',
            'reconnect-overlay',
            'model-picker',
            'model-menu',
            'prompt-card',
            'status-panel'
        ]) {
            expect(out).toContain(`id="${id}"`)
        }
    })

    it('emits a syntactically valid module script (no unescaped newlines etc.)', () => {
        expect(() => new Function(clientScript(mduiHtml('ws://1.2.3.4:8800/ws')))).not.toThrow()
    })

    it('handles every protocol frame the client renders', () => {
        const out = mduiHtml('ws://localhost:7600/ws')
        for (const type of [
            'snapshot',
            'models',
            'agent_start',
            'thinking_delta',
            'text_delta',
            'tool_start',
            'tool_end',
            'user_message',
            'system_note',
            'agent_error',
            'agent_end',
            'context',
            'prompt',
            'prompt_resolved',
            'widget',
            'notify',
            'reset'
        ]) {
            expect(out).toContain(`case '${type}'`)
        }
        expect(out).toContain('prompt_answer')
    })

    it("does not optimistically render the sender's own user bubble", () => {
        // The server records remote-typed messages via addUserTurn, which
        // broadcasts a user_message back to ALL clients — including the sender.
        // If sendMessage ALSO renders the bubble locally, the sender sees it
        // twice. User bubbles must come solely from the user_message delta.
        const out = mduiHtml('ws://localhost:7600/ws')
        const start = out.indexOf('function sendMessage()')
        const end = out.indexOf('function answer(value)', start)
        expect(start).toBeGreaterThan(-1)
        const sendBody = out.slice(start, end)
        expect(sendBody).not.toContain('addBubble(')
    })

    it('guards enabling notifications on permission and secure context', () => {
        const out = mduiHtml('ws://localhost:7600/ws')
        expect(out).toContain('Notification.permission')
        expect(out).toContain('window.isSecureContext')
    })

    it('registers a service worker and a push subscription (works on iOS)', () => {
        const out = mduiHtml('ws://localhost:7600/ws')
        expect(out).toContain("serviceWorker.register('/sw.js')")
        expect(out).toContain('pushManager.subscribe')
        expect(out).toContain('/push-key')
        expect(out).toContain('/subscribe')
        // The broken in-page constructor must NOT be used to deliver notifications.
        expect(out).not.toContain('new Notification(')
    })

    it('shows a live countdown on the reconnect overlay', () => {
        const out = mduiHtml('ws://localhost:7600/ws')
        expect(out).toContain('id="reconnect-msg"')
        expect(out).toContain('reconnectMsg.textContent')
    })

    it('reconnects immediately when the tab is refocused instead of waiting out the backoff', () => {
        const out = mduiHtml('ws://localhost:7600/ws')
        // A backgrounded phone throttles the retry timer and drops the radio, so
        // returning to the tab, or regaining network, must retry at once.
        expect(out).toContain("addEventListener('visibilitychange'")
        expect(out).toContain("addEventListener('online'")
        expect(out).toContain("addEventListener('focus'")
        expect(out).toContain('function connectNow')
        expect(out).toContain('reconnectDelay = 1000')
        // The scheduled reconnect must be cancellable — held in a tracked timer —
        // so an early retry does not leave a second connect firing later.
        expect(out).toContain('reconnectTimer = setTimeout')
    })

    it('clears the remote view on a reset message (new session)', () => {
        const out = mduiHtml('ws://localhost:7600/ws')
        expect(out).toContain("case 'reset'")
    })

    it('reconciles a full snapshot on (re)connect by replacing the whole view', () => {
        const out = mduiHtml('ws://localhost:7600/ws')
        // The snapshot handler is the heart of the sync rebuild: it must wipe the
        // transcript and rebuild from server truth so reconnects never duplicate or
        // strand stale content — and guard each turn so one bad turn can't blank all.
        const m = out.match(/case 'snapshot':[\s\S]*?break;/)
        expect(m).not.toBeNull()
        const handler = m![0]
        expect(handler).toContain("chatLog.innerHTML = ''")
        expect(handler).toContain('renderTurn')
        expect(handler).toContain('renderLiveTurn')
        expect(handler).toContain('renderWidgets()')
        expect(handler).toContain('try { renderTurn(t)')
    })

    it('uses a single task-widget slot, not a per-key map', () => {
        const out = mduiHtml('ws://localhost:7600/ws')
        // ONE slot, so a cleared widget always disappears. A per-key map can strand
        // an orphan: two widgets under different keys, one cleared, one left behind.
        expect(out).toContain('taskWidgetLines')
        expect(out).not.toContain('delete widgets[')
        // The widget delta carries no key — one slot, so there is nothing to key on.
        const m = out.match(/case 'widget':[\s\S]*?break;/)
        expect(m).not.toBeNull()
        expect(m![0]).not.toContain('msg.key')
    })

    it('no longer ships a separate history replay (snapshot subsumes it)', () => {
        const out = mduiHtml('ws://localhost:7600/ws')
        expect(out).not.toContain("case 'history'")
    })

    it('renders an assistant turn as ordered parts (text + thinking + tools interleaved)', () => {
        const out = mduiHtml('ws://localhost:7600/ws')
        // A turn must render its `parts` in sequence so the layout matches the
        // terminal — not one merged text blob with tools dumped at the end.
        const m = out.match(/function renderTurn\(t\) \{[\s\S]*?\n {4}\}/)
        expect(m).not.toBeNull()
        const body = m![0]
        expect(body).toContain('t.parts')
        expect(body).toContain("p.kind === 'text'")
        expect(body).toContain('renderToolPart')
    })

    it('renders persistent system notes (e.g. context compaction) inline', () => {
        const out = mduiHtml('ws://localhost:7600/ws')
        // A system note must render both live (delta) and from the snapshot (a
        // role:'system' turn), as a muted inline divider that survives reconnect.
        expect(out).toContain("case 'system_note'")
        expect(out).toContain('function addSystemLine')
        expect(out).toContain("t.role === 'system'")
        expect(out).toContain('.sysnote')
    })

    it('renders tool results null-safely so a missing result cannot blank the view', () => {
        const out = mduiHtml('ws://localhost:7600/ws')
        // A null/undefined result must not reach `JSON.stringify(...).slice()`, whose
        // `undefined.slice` throws and aborts the snapshot rebuild mid-clear.
        expect(out).toContain('function toolResultText')
        expect(out).toContain('result == null')
        expect(out).not.toContain('JSON.stringify(tool.result, null, 2)')
        expect(out).not.toContain('JSON.stringify(msg.result, null, 2)')
    })

    it('renders content-block tool results as text, not escaped JSON', () => {
        const out = mduiHtml('ws://localhost:7600/ws')
        // Tools (Read, Bash, MCP) return { content: [{type:'text', text:'...'}] };
        // dumping that through JSON.stringify shows the user escaped \n garbage.
        expect(out).toContain('function contentBlocksText')
        expect(out).toContain("b.type === 'text'")
        expect(out).toContain('Array.isArray(result.content)')
    })

    it('summarizes tool calls by kind instead of dumping raw JSON', () => {
        const out = mduiHtml('ws://localhost:7600/ws')
        // toolSummary (ui-tools.ts) turns {command} into "$ …", a path into "read …",
        // etc., and addToolCall passes RAW args (not a pre-stringified blob).
        expect(out).toContain('function toolSummary')
        expect(out).toContain('function toolDiffHtml')
        expect(out).toContain('toolSummary(toolName, args)')
    })

    it('renders assistant text as markdown but leaves user bubbles plain', () => {
        const out = mduiHtml('ws://localhost:7600/ws')
        expect(out).toContain('function renderMarkdown')
        // addBubble markdown-renders only the assistant role.
        const m = out.match(/function addBubble\(role, text\) \{[\s\S]*?\n {4}\}/)
        expect(m).not.toBeNull()
        expect(m![0]).toContain("role === 'assistant'")
        expect(m![0]).toContain('textContent = text')
    })

    it('anchors layout to the bottom safe-area so there is no gap', () => {
        // viewport-fit=cover makes fixed bottom content ride the home indicator
        // unless the CSS consumes the inset.
        expect(mduiHtml('ws://localhost:7600/ws')).toContain('env(safe-area-inset-bottom')
    })
})
