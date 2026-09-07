// Restart backfill: rebuild the remote transcript from pi's persisted session.
//
// SessionState is memory-only, so after a pi restart a freshly connecting
// browser used to stare at an empty page until new activity arrived — even
// though pi itself persists every message to the session file, and
// session_start hands us the session's ReadonlySessionManager. This module
// replays those stored entries into the history buffer, so the reconnect
// snapshot shows the conversation the terminal would `pi -c` back to life.
//
// The reconstruction mirrors the LIVE path's invariants (see events.ts): one
// agent run = one assistant turn whose parts interleave text, thinking and
// tool calls in execution order; tool results arrive as separate messages and
// patch their call part; an errored run becomes a red error turn; a compaction
// marker becomes the same persistent "Context compacted" note the live
// session_compact handler writes.

import type {Turn, Part, ToolPart} from './history.js'
import {getState, snapshot} from './session-state.js'

/** A persisted entry reduced to the fields the reconstruction reads. pi's real
 *  SessionEntry satisfies this; keeping it structural (like model-resolve.ts)
 *  means tests can feed plain literals. */
export interface BackfillEntry {
    type: string
    timestamp: string
    message?: {
        role: string
        content?: unknown
        toolCallId?: string
        toolName?: string
        isError?: boolean
        stopReason?: string
        errorMessage?: string
    }
}

function entryTs(entry: BackfillEntry): number | undefined {
    const ms = Date.parse(entry.timestamp)
    return Number.isNaN(ms) ? undefined : ms
}

/** The text of a persisted user message: a plain string, or its text blocks
 *  joined (images have no place in the transcript). */
function userText(content: unknown): string {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
        return content
            .map(b =>
                b && typeof b === 'object' && (b as {type?: string}).type === 'text' ?
                    String((b as {text?: string}).text ?? '')
                :   ''
            )
            .filter(Boolean)
            .join('\n')
    }
    return ''
}

/** What a stored tool result becomes in a ToolPart. The live path stores the
 *  raw tool-result object, whose text the client extracts from `content`
 *  blocks — so rebuild that shape, and carry the duration from the entry
 *  timestamps the live path computes from wall clock. */
function toolResultValue(entry: NonNullable<BackfillEntry['message']>): unknown {
    return {content: entry.content ?? []}
}

function toolResultMs(
    callTs: number | undefined,
    resultTs: number | undefined
): number | undefined {
    return callTs !== undefined && resultTs !== undefined && resultTs >= callTs ?
            resultTs - callTs
        :   undefined
}

/**
 * Rebuild turns from persisted session entries, oldest → newest. Consecutive
 * assistant messages merge into ONE turn (a run spans multiple LLM calls);
 * a user message, compaction note or error closes the open one.
 */
export function reconstructTurns(entries: readonly BackfillEntry[]): Turn[] {
    const turns: Turn[] = []
    let pending: Part[] | null = null
    let pendingTs: number | undefined

    const flush = (): void => {
        if (pending && pending.length)
            turns.push({role: 'assistant', parts: pending, ts: pendingTs})
        pending = null
        pendingTs = undefined
    }

    for (const entry of entries) {
        if (entry.type === 'compaction') {
            flush()
            turns.push({role: 'system', text: 'Context compacted', ts: entryTs(entry)})
            continue
        }
        if (entry.type !== 'message' || !entry.message) continue
        const m = entry.message
        const ts = entryTs(entry)

        if (m.role === 'user') {
            flush()
            turns.push({role: 'user', text: userText(m.content), ts})
        } else if (m.role === 'assistant') {
            // pi records stopReason 'error' WITHOUT content for a failed call —
            // that is the persisted twin of the live addError() turn.
            if (m.stopReason === 'error' && m.errorMessage) {
                flush()
                turns.push({role: 'assistant', text: m.errorMessage, error: true, ts})
                continue
            }
            pending ??= []
            pendingTs = pendingTs ?? ts
            for (const block of Array.isArray(m.content) ? m.content : []) {
                const b = block as Record<string, unknown>
                if (b.type === 'text' && typeof b.text === 'string') {
                    pending.push({kind: 'text', text: b.text})
                } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
                    pending.push({kind: 'thinking', text: b.thinking, done: true})
                } else if (b.type === 'toolCall' && typeof b.id === 'string') {
                    pending.push({
                        kind: 'tool',
                        toolCallId: b.id,
                        toolName: String(b.name ?? ''),
                        args: b.arguments,
                        result: undefined,
                        isError: false,
                        done: false
                    })
                }
            }
        } else if (m.role === 'toolResult') {
            const patch = (part: ToolPart, at: number | undefined): void => {
                part.result = toolResultValue(m)
                part.isError = m.isError === true
                part.done = true
                const elapsed = toolResultMs(at, ts)
                if (elapsed !== undefined) part.elapsedMs = elapsed
            }
            // The result lands while its call is still open — the normal run
            // order. A result with no open call (abort mid-tool, session cut)
            // patches the last committed turn so the call never dangles.
            const open = pending?.find(
                (p): p is ToolPart => p.kind === 'tool' && p.toolCallId === m.toolCallId
            )
            if (open) {
                patch(open, pendingTs)
            } else {
                for (let i = turns.length - 1; i >= 0; i--) {
                    const t = turns[i]!
                    if (t.role !== 'assistant' || !t.parts) continue
                    const part = t.parts.find(
                        (p): p is ToolPart => p.kind === 'tool' && p.toolCallId === m.toolCallId
                    )
                    if (part) {
                        patch(part, t.ts)
                        break
                    }
                }
            }
        }
    }
    flush()
    return turns
}

/**
 * Seed SessionState's history from the session file and refresh connected
 * browsers. Called from session_start AFTER reset(), so a restart (and a
 * fork/switch, whose target session's entries arrive the same way) shows the
 * persisted conversation; a fresh /new has no message entries and seeds
 * nothing. Best-effort: any failure leaves an empty transcript, never a dead
 * session_start.
 */
export function seedFromSession(ctx: {sessionManager?: {getEntries(): unknown}}): void {
    try {
        const entries = ctx.sessionManager?.getEntries() as BackfillEntry[] | undefined
        if (!Array.isArray(entries)) return
        const turns = reconstructTurns(entries)
        if (turns.length === 0) return
        getState().history.addSeeded(turns)
        // The session_start `reset` already told clients to clear; re-send the
        // now-seeded snapshot so an open browser picks the transcript up
        // without waiting for a reconnect.
        getState().sink(snapshot())
    } catch {
        /* no session available, or an unparseable entry — stay empty */
    }
}
