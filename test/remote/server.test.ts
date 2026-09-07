import {describe, it, expect, beforeEach, afterEach, test} from 'bun:test'
import {mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {
    startServer,
    getLocalIPs,
    formatAddresses,
    listenWithRetry
} from '../../src/remote/server.js'
import type {ServerHandle} from '../../src/remote/server.js'
import {createServer} from 'node:http'
import type {Server} from 'node:http'
import WebSocket from 'ws'
import {getBridge} from '../../src/remote/bridge.js'
import {reset, setPrompt, setContext, addUserTurn} from '../../src/remote/session-state.js'
import {clearSubscriptions, getSubscriptions} from '../../src/remote/push.js'

let handle: ServerHandle | null = null

// The /push-key and /subscribe routes persist vapid.json and subscriptions.json
// under data-home; redirect that at a temp dir so the suite never writes to the
// real ~/.local/share.
let xdgDir: string | null = null
let prevXdg: string | undefined
beforeEach(() => {
    prevXdg = process.env.XDG_DATA_HOME
    xdgDir = mkdtempSync(path.join(tmpdir(), 'server-xdg-'))
    process.env.XDG_DATA_HOME = xdgDir
})

afterEach(() => {
    handle?.stop()
    handle = null
    const b = getBridge()
    b.pending.clear()
    reset()
    if (prevXdg === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = prevXdg
    if (xdgDir) rmSync(xdgDir, {recursive: true, force: true})
    xdgDir = null
})

describe('getLocalIPs', () => {
    const v4 = (address: string, internal = false) => ({
        address,
        family: 'IPv4' as const,
        internal,
        netmask: '255.255.255.0',
        mac: '00:00:00:00:00:00',
        cidr: null
    })

    it('separates the Tailscale address from the LAN address', () => {
        const ips = getLocalIPs({
            tailscale0: [v4('100.92.14.7')],
            eth0: [v4('192.168.1.42')],
            lo: [v4('127.0.0.1', true)]
        })
        expect(ips.tailscale).toBe('100.92.14.7')
        expect(ips.lan).toBe('192.168.1.42')
        expect(ips.primary).toBe('100.92.14.7')
    })

    it('falls back to LAN as primary when there is no Tailscale interface', () => {
        const ips = getLocalIPs({
            eth0: [v4('192.168.1.42')],
            lo: [v4('127.0.0.1', true)]
        })
        expect(ips.tailscale).toBeUndefined()
        expect(ips.lan).toBe('192.168.1.42')
        expect(ips.primary).toBe('192.168.1.42')
    })

    it('ignores internal interfaces and defaults primary to loopback', () => {
        const ips = getLocalIPs({lo: [v4('127.0.0.1', true)]})
        expect(ips.tailscale).toBeUndefined()
        expect(ips.lan).toBeUndefined()
        expect(ips.primary).toBe('127.0.0.1')
    })

    it('does not treat the Tailscale address as the LAN address', () => {
        const ips = getLocalIPs({tailscale0: [v4('100.92.14.7')]})
        expect(ips.tailscale).toBe('100.92.14.7')
        expect(ips.lan).toBeUndefined()
    })
})

describe('formatAddresses', () => {
    it('labels both Tailscale and LAN full URLs', () => {
        const addrs = formatAddresses(
            {tailscale: '100.92.14.7', lan: '192.168.1.42', primary: '100.92.14.7'},
            8800
        )
        expect(addrs).toEqual([
            {label: 'Tailscale', url: 'http://100.92.14.7:8800'},
            {label: 'LAN', url: 'http://192.168.1.42:8800'}
        ])
    })

    it('uses the MagicDNS host for the Tailscale line when provided', () => {
        const addrs = formatAddresses(
            {tailscale: '100.92.14.7', lan: '192.168.1.42', primary: '100.92.14.7'},
            8800,
            'omarchy-1.tailaa4e75.ts.net'
        )
        expect(addrs).toEqual([
            {label: 'Tailscale', url: 'http://omarchy-1.tailaa4e75.ts.net:8800'},
            {label: 'LAN', url: 'http://192.168.1.42:8800'}
        ])
    })

    it('emits only the LAN line when Tailscale is absent', () => {
        const addrs = formatAddresses({lan: '192.168.1.42', primary: '192.168.1.42'}, 8800)
        expect(addrs).toEqual([{label: 'LAN', url: 'http://192.168.1.42:8800'}])
    })

    it('falls back to a single unlabeled primary URL when no interfaces resolve', () => {
        const addrs = formatAddresses({primary: '127.0.0.1'}, 8801)
        expect(addrs).toEqual([{label: '', url: 'http://127.0.0.1:8801'}])
    })
})

describe('startServer', () => {
    it('starts on a port >= 8800', async () => {
        handle = await startServer(
            () => {},
            wsUrl => `<html>${wsUrl}</html>`
        )
        expect(handle.port).toBeGreaterThanOrEqual(8800)
        expect(handle.port).toBeLessThan(8900)
    })

    // Probing each port with a throwaway socket and then binding the REAL server
    // separately opens a TOCTOU window: the port can be taken between the probe
    // and the bind, and the resulting EADDRINUSE escapes as an uncaughtException
    // rather than a rejection. startServer therefore binds the real server
    // directly and retries past an in-use port, resolving on the next free one.
    it('skips an occupied first port and binds a later free port', async () => {
        // Hold 8800 (startServer's first port). Tolerate it already being taken
        // externally — either way the first port is occupied, which is the case
        // under test: the real server must retry past it, not crash.
        const blocker = createServer()
        const held = await new Promise<boolean>(resolve => {
            blocker.once('error', () => resolve(false))
            blocker.listen(8800, '0.0.0.0', () => resolve(true))
        })
        try {
            handle = await startServer(
                () => {},
                () => '<html></html>'
            )
            // 8800 is occupied, so startServer must land above it.
            expect(handle.port).toBeGreaterThan(8800)
            expect(handle.port).toBeLessThan(8900)
        } finally {
            if (held) blocker.close()
        }
    })

    it('HTTP GET / serves the HTML with WS url embedded', async () => {
        handle = await startServer(
            () => {},
            wsUrl => `WSURL:${wsUrl}`
        )
        const res = await fetch(`http://127.0.0.1:${handle.port}/`)
        const body = await res.text()
        expect(res.status).toBe(200)
        expect(body).toContain(`WSURL:ws://`)
        expect(body).toContain(`:${handle.port}/ws`)
    })

    it('WebSocket connects and receives a snapshot reflecting the transcript', async () => {
        addUserTurn('hi')
        handle = await startServer(
            () => {},
            _wsUrl => `<html></html>`
        )
        const received: unknown[] = []
        await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${handle!.port}/ws`)
            ws.on('message', data => {
                received.push(JSON.parse(data.toString()))
                ws.close()
                resolve()
            })
            ws.on('error', reject)
            setTimeout(() => reject(new Error('timeout')), 3000)
        })
        expect(received[0]).toMatchObject({
            type: 'snapshot',
            turns: [{role: 'user', text: 'hi'}]
        })
    })

    it('calls onMessage callback with parsed text when browser sends message', async () => {
        const messages: string[] = []
        handle = await startServer(
            text => messages.push(text),
            () => '<html></html>'
        )
        await new Promise<void>((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${handle!.port}/ws`)
            ws.on('open', () => {
                ws.send(JSON.stringify({type: 'message', text: 'hello agent'}))
                setTimeout(() => {
                    ws.close()
                    resolve()
                }, 100)
            })
            ws.on('error', reject)
        })
        expect(messages).toContain('hello agent')
    })

    it('stop() closes the server', async () => {
        handle = await startServer(
            () => {},
            () => '<html></html>'
        )
        const port = handle.port
        handle.stop()
        handle = null
        await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow()
    })

    // stop() must forcibly TERMINATE live WebSocket connections, not just stop
    // accepting new ones: server.ts loops `wss.clients` calling `terminate()`
    // BEFORE `wss.close()` and `httpServer.close()`. An undrained client socket
    // stays an active event-loop handle, and pi's print mode returns an exit code
    // rather than calling process.exit — its only process.exit is in a signal
    // handler — so it ends by natural loop drain. One lingering socket then keeps
    // the process alive until something kills it.
    it('stop() terminates an open WebSocket client (so the event loop can drain)', async () => {
        handle = await startServer(
            () => {},
            () => '<html></html>'
        )
        const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws`)
        await new Promise<void>((resolve, reject) => {
            ws.on('open', () => resolve())
            ws.on('error', reject)
        })
        const closed = new Promise<boolean>(resolve => {
            ws.on('close', () => resolve(true))
            setTimeout(() => resolve(false), 1000)
        })
        handle.stop()
        handle = null
        expect(await closed).toBe(true)
    })

    it('GET /sw.js serves the service worker as JavaScript', async () => {
        handle = await startServer(
            () => {},
            () => '<html></html>'
        )
        const res = await fetch(`http://127.0.0.1:${handle.port}/sw.js`)
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toContain('javascript')
        const body = await res.text()
        expect(body).toContain('push')
        expect(body).toContain('showNotification')
    })

    it('GET /push-key returns the VAPID public key', async () => {
        handle = await startServer(
            () => {},
            () => '<html></html>'
        )
        const res = await fetch(`http://127.0.0.1:${handle.port}/push-key`)
        expect(res.status).toBe(200)
        const key = await res.text()
        expect(key.length).toBeGreaterThan(20)
    })

    it('POST /subscribe stores the subscription and returns 201', async () => {
        clearSubscriptions()
        handle = await startServer(
            () => {},
            () => '<html></html>'
        )
        const subscription = {
            endpoint: 'https://push.example/abc',
            keys: {p256dh: 'p', auth: 'a'}
        }
        const res = await fetch(`http://127.0.0.1:${handle.port}/subscribe`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(subscription)
        })
        expect(res.status).toBe(201)
        expect(getSubscriptions().map(s => s.endpoint)).toContain('https://push.example/abc')
    })

    it('POST /subscribe rejects a malformed body with 400', async () => {
        handle = await startServer(
            () => {},
            () => '<html></html>'
        )
        const res = await fetch(`http://127.0.0.1:${handle.port}/subscribe`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: 'not json{'
        })
        expect(res.status).toBe(400)
    })
})

describe('listenWithRetry', () => {
    // Bind a throwaway server to a specific port so the port is genuinely in use
    // for the duration of the test; returns a closer.
    async function occupy(port: number): Promise<() => void> {
        const s = createServer()
        await new Promise<void>((resolve, reject) => {
            s.once('error', reject)
            s.listen(port, '0.0.0.0', resolve)
        })
        return () => s.close()
    }

    it('retries past an in-use port and resolves on the next free one', async () => {
        const base = 8850
        const free = await occupy(base) // hold `base`, forcing a bump to base+1
        const server: Server = createServer()
        try {
            const port = await listenWithRetry(server, base, 10)
            expect(port).toBe(base + 1)
        } finally {
            server.close()
            free()
        }
    })

    it('REJECTS (never throws uncaught) when the whole range is in use', async () => {
        const base = 8870
        const closers = await Promise.all([occupy(base), occupy(base + 1)])
        // Capture any uncaughtException so we can prove the failure came back as a
        // REJECTION, not out-of-band. Out-of-band is the crash mode: nothing
        // upstream can catch it.
        const uncaught: unknown[] = []
        const onUncaught = (e: unknown) => uncaught.push(e)
        process.on('uncaughtException', onUncaught)
        const server: Server = createServer()
        try {
            await expect(listenWithRetry(server, base, 2)).rejects.toThrow(
                /No free port found in range/
            )
            // Let any stray async error surface before asserting none did.
            await new Promise(r => setTimeout(r, 20))
            expect(uncaught).toEqual([])
        } finally {
            process.removeListener('uncaughtException', onUncaught)
            server.close()
            for (const c of closers) c()
        }
    })
})

describe('startServer stress (issue #7 regression)', () => {
    // The crash this guards is RATE-DEPENDENT: a probe-then-bind race and a
    // listener-less bind only misfire when a port has not fully released yet. A
    // single start/stop cannot surface that — the port reuses cleanly every time
    // on a fast host. Hammering the WHOLE real path (bind via listenWithRetry ->
    // WebSocketServer attach -> stop() teardown) back-to-back re-creates the
    // "bind a port that was just freed" pressure, and asserts it stays quiet:
    // every cycle resolves to a port in range and NOTHING escapes as an uncaught.
    it('survives many rapid start/stop cycles with zero uncaught errors', async () => {
        const CYCLES = 100
        // Any uncaughtException or unhandledRejection here is the failure mode
        // under test: an error escaping the catch instead of rejecting. Record it,
        // do not let it fail the process, then assert none happened.
        const escaped: unknown[] = []
        const onUncaught = (e: unknown) => escaped.push(e)
        process.on('uncaughtException', onUncaught)
        process.on('unhandledRejection', onUncaught)
        try {
            for (let i = 0; i < CYCLES; i++) {
                const h = await startServer(
                    () => {},
                    () => '<html></html>'
                )
                expect(h.port).toBeGreaterThanOrEqual(8800)
                expect(h.port).toBeLessThan(8900)
                h.stop()
                // Yield a tick so httpServer.close() can progress and the port is
                // released before the next bind — mirrors real restart timing and
                // keeps the loop from drifting up the range on a slow releaser.
                await new Promise(r => setImmediate(r))
            }
            // Drain any late async error before asserting the run was clean.
            await new Promise(r => setTimeout(r, 20))
            expect(escaped).toEqual([])
        } finally {
            process.removeListener('uncaughtException', onUncaught)
            process.removeListener('unhandledRejection', onUncaught)
        }
    })
})

function once(ws: WebSocket, type: string): Promise<Record<string, unknown>> {
    return new Promise(resolve => {
        ws.on('message', d => {
            const m = JSON.parse(d.toString()) as Record<string, unknown>
            if (m.type === type) resolve(m)
        })
    })
}

test('the connect snapshot carries the active prompt', async () => {
    setPrompt({type: 'prompt', id: '42', question: 'Which DB?', allowSkip: false})
    const srv = await startServer(
        () => {},
        () => '<html></html>'
    )
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`)
    const snap = await once(ws, 'snapshot')
    expect((snap.prompt as {id: string}).id).toBe('42')
    ws.close()
    srv.stop()
    reset()
})

test('the connect snapshot carries the last context usage', async () => {
    setContext({tokens: 12000, contextWindow: 100000, percent: 12})
    const srv = await startServer(
        () => {},
        () => '<html></html>'
    )
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`)
    const snap = await once(ws, 'snapshot')
    expect(snap.context).toEqual({tokens: 12000, contextWindow: 100000, percent: 12})
    ws.close()
    srv.stop()
    reset()
})

test('prompt_answer frame resolves the pending prompt', async () => {
    const b = getBridge()
    let resolved: string | undefined = 'UNSET'
    b.pending.set('99', v => (resolved = v))
    const srv = await startServer(
        () => {},
        () => '<html></html>'
    )
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`)
    await new Promise(r => ws.on('open', r))
    ws.send(JSON.stringify({type: 'prompt_answer', id: '99', value: 'sqlite'}))
    await new Promise(r => setTimeout(r, 50))
    expect(resolved).toBe('sqlite')
    ws.close()
    srv.stop()
})

test('interrupt frame invokes the onInterrupt callback', async () => {
    let interrupts = 0
    const srv = await startServer(
        () => {},
        () => '<html></html>',
        () => interrupts++
    )
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`)
    await new Promise(r => ws.on('open', r))
    ws.send(JSON.stringify({type: 'interrupt'}))
    await new Promise(r => setTimeout(r, 50))
    expect(interrupts).toBe(1)
    ws.close()
    srv.stop()
})

test('clear_held frame invokes the onClearHeld callback', async () => {
    let cleared = 0
    const srv = await startServer(
        () => {},
        () => '<html></html>',
        undefined,
        () => cleared++
    )
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`)
    await new Promise(r => ws.on('open', r))
    ws.send(JSON.stringify({type: 'clear_held'}))
    await new Promise(r => setTimeout(r, 50))
    expect(cleared).toBe(1)
    ws.close()
    srv.stop()
})

// Discarding held text is not a chat message: it must work while a prompt card
// has the composer disabled, exactly like the Stop button does.
test('clear_held is honored even while a prompt is pending', async () => {
    setPrompt({type: 'prompt', id: '7', question: 'q', allowSkip: false})
    let cleared = 0
    const srv = await startServer(
        () => {},
        () => '<html></html>',
        undefined,
        () => cleared++
    )
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`)
    await new Promise(r => ws.on('open', r))
    ws.send(JSON.stringify({type: 'clear_held'}))
    await new Promise(r => setTimeout(r, 50))
    expect(cleared).toBe(1)
    ws.close()
    srv.stop()
    reset()
})

test('interrupt is honored even while a prompt is pending', async () => {
    setPrompt({type: 'prompt', id: '5', question: 'q', allowSkip: false})
    let interrupts = 0
    const srv = await startServer(
        () => {},
        () => '<html></html>',
        () => interrupts++
    )
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`)
    await new Promise(r => ws.on('open', r))
    ws.send(JSON.stringify({type: 'interrupt'}))
    await new Promise(r => setTimeout(r, 50))
    expect(interrupts).toBe(1)
    ws.close()
    srv.stop()
    reset()
})

test('plain message is ignored while a prompt is pending', async () => {
    setPrompt({type: 'prompt', id: '7', question: 'q', allowSkip: false})
    let got = ''
    const srv = await startServer(
        text => (got = text),
        () => '<html></html>'
    )
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`)
    await new Promise(r => ws.on('open', r))
    ws.send(JSON.stringify({type: 'message', text: 'should be dropped'}))
    await new Promise(r => setTimeout(r, 50))
    expect(got).toBe('')
    ws.close()
    srv.stop()
    reset()
})

// The model picker rides two server behaviors: the connect-time models frame
// feeding the menu, and set_model reaching the switcher callback. A rejected
// or empty spec must not reach the callback — validation is isClientMessage's.
test('models frame is sent to a fresh connection when getModels answers', async () => {
    const srv = await startServer(
        () => {},
        () => '<html></html>',
        undefined,
        undefined,
        undefined,
        () => ({
            type: 'models',
            current: 'p/a',
            models: [
                {spec: 'p/a', name: 'A'},
                {spec: 'p/b', name: 'B'}
            ]
        })
    )
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`)
    const frame = await once(ws, 'models')
    expect(frame.current).toBe('p/a')
    expect(frame.models).toEqual([
        {spec: 'p/a', name: 'A'},
        {spec: 'p/b', name: 'B'}
    ])
    ws.close()
    srv.stop()
})

test('no models frame when getModels answers null (no live ctx yet)', async () => {
    const srv = await startServer(
        () => {},
        () => '<html></html>',
        undefined,
        undefined,
        undefined,
        () => null
    )
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`)
    const seen: string[] = []
    ws.on('message', d => seen.push((JSON.parse(d.toString()) as {type: string}).type))
    await new Promise(r => ws.on('open', r))
    await new Promise(r => setTimeout(r, 50))
    expect(seen).toEqual(['snapshot'])
    ws.close()
    srv.stop()
})

test('set_model frame invokes the onSetModel callback with the spec', async () => {
    const specs: string[] = []
    const srv = await startServer(
        () => {},
        () => '<html></html>',
        undefined,
        undefined,
        spec => specs.push(spec)
    )
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`)
    await new Promise(r => ws.on('open', r))
    ws.send(JSON.stringify({type: 'set_model', spec: 'openai/gpt-4o'}))
    await new Promise(r => setTimeout(r, 50))
    expect(specs).toEqual(['openai/gpt-4o'])
    ws.close()
    srv.stop()
})

test('set_model with an empty spec is dropped before the callback', async () => {
    let calls = 0
    const srv = await startServer(
        () => {},
        () => '<html></html>',
        undefined,
        undefined,
        () => calls++
    )
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`)
    await new Promise(r => ws.on('open', r))
    ws.send(JSON.stringify({type: 'set_model', spec: ''}))
    await new Promise(r => setTimeout(r, 50))
    expect(calls).toBe(0)
    ws.close()
    srv.stop()
})

test('a handler that throws synchronously degrades to an error toast, never an uncaughtException', async () => {
    // The real killer this guards: pi invalidates a captured ExtensionAPI on
    // every session replacement, and calling it throws SYNCHRONOUSLY. That
    // throw used to escape the ws message handler and pi exited.
    const srv = await startServer(
        () => {},
        () => '<html></html>',
        undefined,
        undefined,
        () => {
            throw new Error('This extension ctx is stale after session replacement or reload.')
        }
    )
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`)
    await new Promise(r => ws.on('open', r))
    ws.send(JSON.stringify({type: 'set_model', spec: 'p/a'}))
    const frame = await once(ws, 'notify')
    expect(frame).toMatchObject({type: 'notify', level: 'error'})
    ws.close()
    srv.stop()
})

test('the session sidebar: list rides connect, refreshes on demand, switch reaches the handler', async () => {
    // Holder, not a bare `let`: TS can't see the callback assignment and would
    // narrow the variable to null at the assertion.
    const state: {switched: string | null} = {switched: null}
    let listCalls = 0
    const srv = await startServer(
        () => {},
        () => '<html></html>',
        undefined,
        undefined,
        undefined,
        () => null,
        () => {
            listCalls++
            return {
                type: 'sessions',
                current: '/sessions/a.jsonl',
                sessions: [
                    {
                        path: '/sessions/a.jsonl',
                        name: 'auth work',
                        firstMessage: 'fix the login flow',
                        modified: '2026-09-07T10:00:00Z',
                        messageCount: 12
                    }
                ]
            }
        },
        picked => {
            state.switched = picked
        }
    )
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`)
    await new Promise(r => ws.on('open', r))
    // The connect greeting carries the sidebar data alongside the snapshot.
    const greeting = await once(ws, 'sessions')
    expect(greeting).toMatchObject({current: '/sessions/a.jsonl'})
    expect(greeting.sessions).toHaveLength(1)
    expect(listCalls).toBe(1)

    // Drawer opened → explicit refresh.
    ws.send(JSON.stringify({type: 'list_sessions'}))
    await once(ws, 'sessions')
    expect(listCalls).toBe(2)

    // A row tap reaches the switch handler with the picked path.
    ws.send(JSON.stringify({type: 'switch_session', path: '/sessions/b.jsonl'}))
    await new Promise(r => setTimeout(r, 50))
    expect(state.switched).toBe('/sessions/b.jsonl')
    ws.close()
    srv.stop()
})
