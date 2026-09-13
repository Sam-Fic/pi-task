// Session enumeration for the browser sidebar.
//
// pi persists every session as a JSONL file under ~/.pi/agent/sessions/<encoded-
// cwd>/, and SessionManager.list(cwd) already knows how to scan that directory —
// parsing each file's header and entries into a SessionInfo (display name,
// first message, message count, mtime). This module is a thin projection of
// that onto the wire shape the sidebar renders, so the browser never needs to
// know where sessions live.

import {unlink} from 'node:fs/promises'
import {SessionManager} from '@earendil-works/pi-coding-agent'
import type {SessionsMessage} from './protocol.js'

/** A sidebar row's data. `name` is the user-set display name — the browser
 *  falls back to `firstMessage` when the session was never named. */
export type SessionSummary = SessionsMessage['sessions'][number]

/**
 * List this project's sessions, newest write first. `sessionDir` overrides the
 * default directory (tests point it at a temp dir); production always omits it.
 */
export async function listSessionSummaries(
    cwd: string,
    sessionDir?: string
): Promise<SessionSummary[]> {
    try {
        const infos = await SessionManager.list(cwd, sessionDir)
        return infos.map(i => ({
            path: i.path,
            name: i.name ?? null,
            firstMessage: (i.firstMessage ?? '').slice(0, 120),
            modified: i.modified.toISOString(),
            messageCount: i.messageCount
        }))
    } catch {
        return []
    }
}

/**
 * The listed sessions with the ACTIVE one guaranteed present.
 *
 * pi writes a session file only once the session holds an ASSISTANT message, so
 * a brand-new conversation (and one whose turns are still all user-side) has a
 * sessionFile that does not exist on disk: `SessionManager.list` cannot see it,
 * and the sidebar ends up with no row marked current — the conversation the user
 * is actually in would be the one entry the history is missing. Synthesize that
 * row (flagged `unsaved`) so the list always answers "where am I". It is placed
 * first and keyed by path, so the real row replaces it in place the moment pi
 * flushes the file.
 */
export function withCurrentSession(
    sessions: SessionSummary[],
    current: string | null
): SessionSummary[] {
    if (!current || sessions.some(s => s.path === current)) return sessions
    return [
        {
            path: current,
            name: null,
            firstMessage: '',
            modified: new Date().toISOString(),
            messageCount: 0,
            unsaved: true
        },
        ...sessions
    ]
}

/**
 * Delete one persisted session file.
 *
 * The allow-list is the scan itself: a WS client can send any path, so the
 * request is only honoured when `SessionManager.list` actually returned it —
 * pi never lists anything outside the session directory or anything that is
 * not a session file, which rules out arbitrary-file deletion without
 * replicating pi's directory encoding here (getDefaultSessionDir is not
 * re-exported from the package root). Cost is one extra scan per delete,
 * same budget as the refresh that follows it.
 *
 * A file vanishing between the scan and the unlink (raced with pi's own
 * flush, or deleted from another client) still ends in the requested state,
 * so ENOENT counts as success.
 */
export async function deleteSessionFile(
    path: string,
    cwd: string,
    sessionDir?: string
): Promise<{ok: true} | {ok: false; reason: 'unknown_session' | 'failed'}> {
    let sessions: Awaited<ReturnType<typeof SessionManager.list>>
    try {
        sessions = await SessionManager.list(cwd, sessionDir)
    } catch {
        return {ok: false, reason: 'failed'}
    }
    if (!sessions.some(s => s.path === path)) return {ok: false, reason: 'unknown_session'}
    try {
        await unlink(path)
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {ok: true}
        return {ok: false, reason: 'failed'}
    }
    return {ok: true}
}
