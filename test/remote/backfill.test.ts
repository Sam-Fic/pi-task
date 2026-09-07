import {afterEach, beforeEach, describe, expect, test} from 'bun:test'
import {reconstructTurns, seedFromSession} from '../../src/remote/backfill.js'
import type {BackfillEntry} from '../../src/remote/backfill.js'
import {HistoryBuffer} from '../../src/remote/history.js'
import type {ToolPart, Turn} from '../../src/remote/history.js'
import {_setSink, getState, reset, snapshot} from '../../src/remote/session-state.js'

/** A persisted entry the way pi writes it: ISO timestamp + message. */
function msg(timestamp: string, message: BackfillEntry['message']): BackfillEntry {
    return {type: 'message', timestamp, message} as BackfillEntry
}

beforeEach(() => {
    reset()
})
afterEach(() => {
    reset()
    _setSink(_m => {
        /* tests that do not capture just swallow */
    })
})

describe('reconstructTurns()', () => {
    test('user string content round-trips as a user turn', () => {
        const turns = reconstructTurns([
            msg('2026-09-07T10:00:00Z', {role: 'user', content: 'hello pi'})
        ])
        expect(turns).toEqual([
            {role: 'user', text: 'hello pi', ts: Date.parse('2026-09-07T10:00:00Z')}
        ])
    })

    test('user block content joins its text blocks and skips images', () => {
        const turns = reconstructTurns([
            msg('2026-09-07T10:00:00Z', {
                role: 'user',
                content: [
                    {type: 'text', text: 'look at'},
                    {type: 'image', mimeType: 'image/png', data: 'AAAA'},
                    {type: 'text', text: 'this'}
                ]
            })
        ])
        expect(turns[0]).toMatchObject({role: 'user', text: 'look at\nthis'})
    })

    test('one run = one assistant turn: consecutive messages merge, text/thinking/tools interleave in order', () => {
        const turns = reconstructTurns([
            msg('2026-09-07T10:00:00Z', {role: 'user', content: 'read it'}),
            msg('2026-09-07T10:00:05Z', {
                role: 'assistant',
                stopReason: 'toolUse',
                content: [
                    {type: 'thinking', thinking: 'need the file'},
                    {type: 'toolCall', id: 't1', name: 'read', arguments: {path: '/a'}}
                ]
            }),
            msg('2026-09-07T10:00:08Z', {
                role: 'toolResult',
                toolCallId: 't1',
                toolName: 'read',
                content: [{type: 'text', text: 'file body'}],
                isError: false
            }),
            msg('2026-09-07T10:00:09Z', {
                role: 'assistant',
                stopReason: 'endTurn',
                content: [{type: 'text', text: 'here it is'}]
            })
        ])
        expect(turns).toHaveLength(2)
        const run = turns[1]!
        expect(run.role).toBe('assistant')
        expect(run.parts).toHaveLength(3)
        expect(run.parts?.map(p => p.kind)).toEqual(['thinking', 'tool', 'text'])
        const tool = run.parts![1] as ToolPart
        expect(tool).toMatchObject({
            toolCallId: 't1',
            toolName: 'read',
            args: {path: '/a'},
            done: true,
            isError: false
        })
        // The result rebuilds the client-rendered {content: blocks} shape, and
        // elapsedMs comes from the call/result entry timestamps.
        expect(tool.result).toEqual({content: [{type: 'text', text: 'file body'}]})
        expect(tool.elapsedMs).toBe(3000)
    })

    test('an errored run becomes a red error turn, like the live addError path', () => {
        const turns = reconstructTurns([
            msg('2026-09-07T10:00:00Z', {role: 'user', content: 'go'}),
            msg('2026-09-07T10:00:02Z', {
                role: 'assistant',
                stopReason: 'error',
                errorMessage: 'rate limited',
                content: []
            })
        ])
        expect(turns[1]).toEqual({
            role: 'assistant',
            text: 'rate limited',
            error: true,
            ts: Date.parse('2026-09-07T10:00:02Z')
        })
    })

    test('a compaction marker becomes the persistent system note', () => {
        const turns = reconstructTurns([
            msg('2026-09-07T10:00:00Z', {role: 'user', content: 'hi'}),
            {type: 'compaction', timestamp: '2026-09-07T10:01:00Z'}
        ])
        expect(turns[1]).toMatchObject({role: 'system', text: 'Context compacted'})
    })

    test('a result with no open call patches the last committed turn (abort mid-tool)', () => {
        const turns = reconstructTurns([
            msg('2026-09-07T10:00:00Z', {role: 'user', content: 'go'}),
            msg('2026-09-07T10:00:01Z', {
                role: 'assistant',
                stopReason: 'toolUse',
                content: [{type: 'toolCall', id: 't1', name: 'bash', arguments: {}}]
            }),
            // Session cut before any result, then the restart replays… no: the
            // result arrives after a following user message committed the call.
            msg('2026-09-07T10:00:20Z', {role: 'user', content: 'again'}),
            msg('2026-09-07T10:00:21Z', {
                role: 'toolResult',
                toolCallId: 't1',
                toolName: 'bash',
                content: [{type: 'text', text: 'late output'}],
                isError: true
            })
        ])
        const run = turns[1]!
        const tool = run.parts![0] as ToolPart
        expect(tool.done).toBe(true)
        expect(tool.isError).toBe(true)
        expect(tool.result).toEqual({content: [{type: 'text', text: 'late output'}]})
    })

    test('unknown entry types (model_change, labels) are skipped', () => {
        const turns = reconstructTurns([
            {type: 'model_change', timestamp: '2026-09-07T10:00:00Z'} as BackfillEntry,
            msg('2026-09-07T10:00:01Z', {role: 'user', content: 'hi'})
        ])
        expect(turns).toHaveLength(1)
    })
})

describe('HistoryBuffer.addSeeded()', () => {
    test('keeps the newest turns within the limit and preserves order', () => {
        const h = new HistoryBuffer(3)
        const turns: Turn[] = [1, 2, 3, 4, 5].map(i => ({
            role: 'user',
            text: `m${i}`,
            ts: 1000 + i
        }))
        h.addSeeded(turns)
        expect(h.getEntries().map(t => t.text)).toEqual(['m3', 'm4', 'm5'])
    })
})

describe('seedFromSession()', () => {
    test('seeds the history and broadcasts a snapshot carrying the persisted turns', () => {
        const seen: unknown[] = []
        _setSink(m => seen.push(m))
        seedFromSession({
            sessionManager: {
                getEntries: () => [
                    msg('2026-09-07T10:00:00Z', {role: 'user', content: 'survived restart'})
                ]
            }
        })
        expect(getState().history.getEntries()[0]).toMatchObject({
            role: 'user',
            text: 'survived restart'
        })
        expect(seen).toHaveLength(1)
        const frame = seen[0] as ReturnType<typeof snapshot>
        expect(frame.type).toBe('snapshot')
        expect(frame.turns[0]).toMatchObject({text: 'survived restart'})
    })

    test('a session without a manager or with no messages seeds nothing', () => {
        const seen: unknown[] = []
        _setSink(m => seen.push(m))
        seedFromSession({})
        seedFromSession({sessionManager: {getEntries: () => []}})
        seedFromSession({
            sessionManager: {
                getEntries: () => [
                    {type: 'model_change', timestamp: '2026-09-07T10:00:00Z'} as BackfillEntry
                ]
            }
        })
        expect(getState().history.getEntries()).toEqual([])
        expect(seen).toEqual([])
    })

    test('a throwing sessionManager stays best-effort — startup never dies', () => {
        expect(() =>
            seedFromSession({
                sessionManager: {
                    getEntries: () => {
                        throw new Error('session file corrupt')
                    }
                }
            })
        ).not.toThrow()
        expect(getState().history.getEntries()).toEqual([])
    })
})
