// Session enumeration for the browser sidebar.
//
// pi persists every session as a JSONL file under ~/.pi/agent/sessions/<encoded-
// cwd>/, and SessionManager.list(cwd) already knows how to scan that directory —
// parsing each file's header and entries into a SessionInfo (display name,
// first message, message count, mtime). This module is a thin projection of
// that onto the wire shape the sidebar renders, so the browser never needs to
// know where sessions live.

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
