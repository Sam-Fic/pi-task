import type {ExtensionAPI, ExtensionCommandContext} from '@earendil-works/pi-coding-agent'
import {getConfig} from '../config/config.js'
import {
    getBridge,
    dispatchRemoteLine,
    dispatchRemoteNewSession,
    makeShimmedCtx,
    isCtxUsable,
    CTX_BOOTSTRAP_COMMAND,
    interruptAgent,
    registerBridgeCommand,
    registerRemoteOnlyCommand,
    publishNotify,
    cancelPendingPrompts,
    notifyBoth,
    dispatchRemoteSwitchSession
} from './bridge.js'
import {setupEvents} from './events.js'
import {seedFromSession} from './backfill.js'
import {listSessionSummaries} from './sessions.js'
import {reset, addUserTurn, setHeld, getState} from './session-state.js'
import {mduiHtml as html} from './ui-mdui.js'
import {resolveModel, specOf} from '../shared/model-resolve.js'
import type {ModelsMessage} from './protocol.js'
import {qrLines} from './qr.js'
import {startServer, formatAddresses} from './server.js'
import {
    ensureTailscaleServe,
    teardownTailscaleServe,
    planRemoteUrls,
    hostFromResult
} from './tailscale.js'
import type {ServeResult} from './tailscale.js'
import {
    holdInput,
    isRunActive,
    clearHeldInput,
    heldInput,
    setHeldInputListener
} from '../task/mid-run-input.js'
import type {ServerHandle} from './server.js'

// Shared state parked on globalThis. pi loads extensions through
// `createJiti(..., {moduleCache: false})`, so a reload re-evaluates this module
// and resets its module-level state; globalThis survives that, which is what
// keeps the server running and messages flowing.
type Shared = {
    server: ServerHandle | null
    send: ((text: string, opts?: {deliverAs: 'steer' | 'followUp'}) => void) | null
    serveResult: ServeResult | null
    /**
     * The newest ExtensionAPI. The server outlives every registration (globalThis
     * S.server survives reloads and session replacements, each of which rebuilds
     * the runner and calls registerRemote again), so the `pi` captured by the
     * FIRST ensureServer call is stale after any of them — pi invalidates it and
     * every call on it throws. Message-time code must read the current
     * generation's API from here instead.
     */
    pi: ExtensionAPI | null
    /** Current session's cwd and file, re-seeded at every session_start and
     *  session switch — the sidebar's list and "current" marker read them. */
    cwd: string | null
    sessionPath: string | null
    /** Prevent showing the QR overlay more than once per server lifetime. */
    qrOverlayShown: boolean
    remoteUrl: string | undefined
}
const _g = globalThis as unknown as Record<string, Shared | undefined>
if (!_g.__piRemote)
    _g.__piRemote = {
        server: null,
        send: null,
        serveResult: null,
        pi: null,
        cwd: null,
        sessionPath: null,
        qrOverlayShown: false,
        remoteUrl: undefined
    }

const S = _g.__piRemote!

/**
 * Where a plain (non-slash) browser line goes. Exported so
 * test/remote/mid-run-routing.test.ts drives the shipped decision rather than a
 * copy of it — these three branches are the whole of issue #8.
 */
export function routePlainLine(
    plain: string,
    send: (text: string, opts?: {deliverAs: 'steer' | 'followUp'}) => void
): void {
    addUserTurn(plain)
    // Read the run flag from SessionState, which is the only thing that owns it.
    // Three functions clear it — agentEnd, addError and reset — so anything
    // mirroring the flag here would have to track an errored turn and a /new as
    // well as a finished one, and would steer into a turn SessionState already
    // considers over whenever it missed one.
    if (getState().agentRunning) {
        // A live turn: steer it (inject into the current generation) so the
        // nudge lands immediately.
        send(plain, {deliverAs: 'steer'})
    } else if (isRunActive()) {
        // Idle, but a task run owns the session — which is most of a run, since
        // the spec phases and every gate are child processes. pi documents
        // sendUserMessage as "Always triggers a turn", so sending here opens a
        // SECOND turn beside the run. Hold it for the next task turn instead.
        holdInput(plain)
    } else {
        send(plain)
    }
}

export function registerRemote(pi: ExtensionAPI): void {
    // This generation's API. Every session replacement (newSession/fork/
    // switchSession) and every reload rebuilds the extension runner and lands
    // here with a live pi; the one the server's closures captured is dead.
    S.pi = pi
    // Hidden no-op command (see CTX_BOOTSTRAP_COMMAND): running it is the only
    // way to obtain a real command ctx without user interaction. Its whole
    // effect happens in registerBridgeCommand's wrapper, which stores the ctx
    // the host dispatch hands it.
    registerBridgeCommand(pi, CTX_BOOTSTRAP_COMMAND, {
        description: 'Internal: refresh the remote bridge session context.',
        handler: () => {}
    })
    // The browser's model picker: every authed model in the registry (never
    // getAll() — an unauthed one cannot answer, same rule as liveCatalog), plus
    // the session's current as a canonical spec so the menu can tick a row.
    // null = nothing to show (no live ctx yet, or a registry that cannot
    // answer because its ctx went stale).
    function collectModels(): ModelsMessage | null {
        const ctx = getBridge().currentCtx
        if (!ctx) return null
        try {
            const available = ctx.modelRegistry.getAvailable()
            return {
                type: 'models',
                current: ctx.model ? specOf(ctx.model) : null,
                models: available.map(m => ({spec: specOf(m), name: m.name}))
            }
        } catch {
            return null
        }
    }
    function broadcastModels(): void {
        const frame = collectModels()
        if (frame) getBridge().broadcast(frame)
    }

    async function ensureServer(): Promise<ServerHandle> {
        if (S.server) return S.server
        S.server = await startServer(
            text => {
                if (text === '/new') {
                    // The reset inside a new session clears the browser's prompt
                    // card, so a parked ask has lost its last surface. Only HERE:
                    // session_start also fires for the /task handoff's own
                    // newSession, and cancelling there reads to the planner as the
                    // user skipping a question they never saw.
                    cancelPendingPrompts()
                    dispatchRemoteNewSession(newCtx => {
                        S.send = (msg, opts) => {
                            void (opts ?
                                newCtx.sendUserMessage(msg, opts)
                            :   newCtx.sendUserMessage(msg))
                        }
                    })
                    return
                }
                dispatchRemoteLine(text, {
                    onPlain: plain => routePlainLine(plain, (t, opts) => S.send?.(t, opts))
                })
            },
            wsUrl => html(wsUrl),
            interruptAgent,
            clearHeldInput,
            // Remote-initiated model switch. pi.setModel persists the choice
            // session-globally and re-clamps thinking; a rejected handle must
            // not silently no-op, so each outcome announces itself. The API is
            // read at message time — a captured one is stale after any session
            // replacement — and a stale one THROWS SYNCHRONOUSLY, so the try
            // wraps the call itself: the promise .catch only covers async
            // failures, and an uncaught sync throw here kills pi outright.
            spec => {
                const ctx = getBridge().currentCtx
                const resolved = ctx ? resolveModel(ctx, spec) : undefined
                if (!resolved) {
                    publishNotify(`Unknown model: ${spec}`, 'warning')
                    return
                }
                try {
                    void (S.pi ?? pi)
                        .setModel(resolved.handle)
                        .then(ok => {
                            if (!ok) {
                                publishNotify(`Model switch to ${resolved.name} failed`, 'error')
                                return
                            }
                            publishNotify(`Model: ${resolved.name}`, 'info')
                            broadcastModels()
                        })
                        .catch(err =>
                            publishNotify(`Model switch failed: ${(err as Error).message}`, 'error')
                        )
                } catch (err) {
                    publishNotify(`Model switch failed: ${(err as Error).message}`, 'error')
                }
            },
            collectModels,
            // The session sidebar: the project's persisted sessions with the
            // active one marked. cwd/sessionPath are re-seeded at every
            // session_start, so this reads current state at call time.
            async () => {
                if (!S.cwd) return null
                return {
                    type: 'sessions' as const,
                    current: S.sessionPath,
                    sessions: await listSessionSummaries(S.cwd)
                }
            },
            // Sidebar pick → switch the live session. The replacement re-runs
            // registration (whose session_start resets + backfills the target
            // transcript into the browser); here we only adopt the fresh send
            // path and re-mark every sidebar's current row.
            path =>
                dispatchRemoteSwitchSession(path, newCtx => {
                    S.send = (msg, opts) => {
                        void (opts ?
                            newCtx.sendUserMessage(msg, opts)
                        :   newCtx.sendUserMessage(msg))
                    }
                    S.sessionPath = newCtx.sessionManager.getSessionFile() ?? null
                    S.cwd = newCtx.sessionManager.getCwd()
                    void listSessionSummaries(S.cwd)
                        .then(sessions =>
                            getState().sink({type: 'sessions', current: S.sessionPath, sessions})
                        )
                        .catch(() => {})
                })
        )
        // Hands-off HTTPS: point Tailscale serve at our port so phones get a
        // secure context. Best-effort — any failure degrades to the http URL.
        S.serveResult = await ensureTailscaleServe(S.server.port).catch((): ServeResult => ({
            state: 'unavailable'
        }))
        return S.server
    }

    pi.on('session_start', (_event, ctx) => {
        S.send = (text, opts) => (opts ? pi.sendUserMessage(text, opts) : pi.sendUserMessage(text))
        S.cwd = ctx.sessionManager?.getCwd?.() ?? S.cwd
        S.sessionPath = ctx.sessionManager?.getSessionFile?.() ?? S.sessionPath
        const bridge = getBridge()
        reset()
        seedFromSession(ctx)
        setupEvents(pi)
        setHeldInputListener(() => setHeld(heldInput(), isRunActive()))
        if (!isCtxUsable(bridge.currentCtx)) {
            bridge.currentCtx = makeShimmedCtx(ctx)
            if (getConfig().remote) {
                pi.sendUserMessage(`/${CTX_BOOTSTRAP_COMMAND}`, {expandPromptTemplates: true})
            }
        }
        broadcastModels()
        if (getConfig().remote) {
            void ensureServer()
                .then(server => {
                    if (!S.qrOverlayShown) {
                        S.qrOverlayShown = true
                        const url = `http://${server.ip}:${server.port}`
                        S.remoteUrl = url
                        ctx.ui.setStatus('remote', url)
                        notifyBoth(ctx, `Remote running at ${url}`, 'info')
                    }
                })
                .catch(err =>
                    notifyBoth(ctx, `Remote UI unavailable: ${(err as Error).message}`, 'warning')
                )
        }
    })

    pi.on('session_shutdown', (event, _ctx) => {
        if (event.reason === 'quit') {
            if (S.server) {
                const port = S.server.port
                S.server.stop()
                S.server = null
                S.serveResult = null
                S.qrOverlayShown = false
                S.remoteUrl = undefined
                _ctx.ui.setStatus('remote', '')
                void teardownTailscaleServe(port).catch(() => {})
            }
            S.send = null
        }
    })

    // The browser advertises /compact, and pi's TUI intercepts `/compact` before any
    // extension command dispatch — so it can only reach the session through the
    // bridge, via the ctx.compact() action every ExtensionContext carries.
    registerRemoteOnlyCommand('compact', (args, ctx) => {
        const customInstructions = args.trim() || undefined
        ctx.compact({
            ...(customInstructions ? {customInstructions} : {}),
            onComplete: () => publishNotify('Context compacted', 'info'),
            onError: err => publishNotify(`Compaction failed: ${err.message}`, 'error')
        })
        publishNotify('Compacting context…', 'info')
    })

    // registerBridgeCommand, not registerRemoteOnlyCommand: this one needs to
    // exist in the terminal AND on the bridge, so `/remote stop` also works typed
    // in the browser — the web UI advertises it, and while a /task-auto run holds
    // the host command loop the browser is the only live input surface.
    registerBridgeCommand(pi, 'remote', {
        description: 'Show the remote QR code & URLs.',
        handler: async (args, ctx) => {
            if (!getConfig().remote) {
                notifyBoth(ctx, 'Remote is disabled — enable it in /task-config.', 'info')
                return
            }
            if (args.trim() === 'stop') {
                if (S.server) {
                    const port = S.server.port
                    S.server.stop()
                    S.server = null
                    S.serveResult = null
                    S.qrOverlayShown = false
                    S.remoteUrl = undefined
                    ctx.ui.setStatus('remote', '')
                    void teardownTailscaleServe(port).catch(() => {})
                    notifyBoth(ctx, 'Remote server stopped', 'info')
                } else {
                    notifyBoth(ctx, 'Remote server is not running', 'warning')
                }
                return
            }

            // Upgrade from shimmed ctx to a real command-capable ctx.
            getBridge().currentCtx = ctx

            try {
                const server = await ensureServer()
                const url = `http://${server.ip}:${server.port}`
                S.remoteUrl = url
                ctx.ui.setStatus('remote', url)
                await showRemoteQrOverlay(ctx, server, S.serveResult ?? {state: 'unavailable'})
                notifyBoth(ctx, `Remote running at ${url}`, 'info')
            } catch (err) {
                notifyBoth(ctx, `Remote UI unavailable: ${(err as Error).message}`, 'error')
            }
        }
    })
}

async function showRemoteQrOverlay(
    ctx: Pick<ExtensionCommandContext, 'ui' | 'mode'>,
    server: ServerHandle,
    result: ServeResult
): Promise<void> {
    const httpPrimary = `http://${server.ip}:${server.port}`
    const plan = planRemoteUrls(httpPrimary, result, server.port)
    const primaryUrl = plan.primaryUrl
    const qr = await qrLines(primaryUrl)

    const tsHost = hostFromResult(result)
    const addrs = [...plan.urlLines, ...formatAddresses(server.ips, server.port, tsHost)]
    const labelW = addrs.reduce((m, a) => Math.max(m, a.label.length), 0)
    const addrLines = [
        ...addrs.map(a => (a.label ? `${a.label.padEnd(labelW)}  ${a.url}` : a.url)),
        ...plan.hintLines
    ]
    const addrWidth = addrLines.reduce((m, l) => Math.max(m, l.length), 0)

    if (ctx.mode === 'tui') {
        // eslint-disable-next-line no-control-regex -- strip ANSI SGR escapes to measure visible width
        const stripAnsi = (s: string) => s.replace(/\x1b\[[^m]*m/g, '')
        const visWidth = qr.reduce((max, l) => Math.max(max, stripAnsi(l).length), 0)
        const overlayWidth = Math.max(visWidth, addrWidth + 4, 36)

        await ctx.ui
            .custom<void>(
                (_tui, _theme, _kb, done) => ({
                    focused: false,
                    render: w => {
                        const c = (s: string, len: number) =>
                            ' '.repeat(Math.max(0, Math.floor((w - len) / 2))) + s
                        return [
                            '',
                            ...qr.map(l => c(l, visWidth)),
                            '',
                            ...addrLines.map(l => c(l, addrWidth)),
                            '',
                            c('Waiting for connection…', 23),
                            c('(any key to dismiss)', 20)
                        ]
                    },
                    handleInput: () => done(undefined),
                    invalidate: () => {},
                    dispose: () => done(undefined)
                }),
                {
                    overlay: true,
                    overlayOptions: {width: overlayWidth},
                    onHandle: h => {
                        server.onFirstConnect = () => h.hide()
                    }
                }
            )
            .catch(() => {})
    }
}
