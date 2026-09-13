import {existsSync, mkdtempSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test, expect} from 'bun:test'
import {SessionManager} from '@earendil-works/pi-coding-agent'
import {
    deleteSessionFile,
    listSessionSummaries,
    withCurrentSession
} from '../../src/remote/sessions.js'

/** appendMessage demands pi's full AgentMessage metadata (api/provider/usage…);
 *  the persistence layer only serializes what it gets, so the test literals
 *  cast to the parameter type and keep the JSONL shape honest where it matters
 *  (role + content). */
function append(mgr: SessionManager, message: object): void {
    mgr.appendMessage(message as Parameters<SessionManager['appendMessage']>[0])
}

// Real session files, written through pi's own SessionManager into a temp dir
// — the sidebar reads exactly what the terminal writes. Note pi persists a
// session file only once it contains an ASSISTANT message, so both sessions
// get a reply; a user-only session never touches disk.
test('lists the project sessions newest-first with sidebar fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-remote-sessions-'))
    const cwd = process.cwd()

    const older = SessionManager.create(cwd, dir)
    append(older, {role: 'user', content: 'first conversation'})
    append(older, {role: 'assistant', content: [{type: 'text', text: 'hello'}]})
    await Bun.sleep(20) // mtime ordering must be real, not same-millisecond luck
    const newer = SessionManager.create(cwd, dir)
    append(newer, {role: 'user', content: 'second conversation'})
    append(newer, {role: 'assistant', content: [{type: 'text', text: 'hi'}]})

    const out = await listSessionSummaries(cwd, dir)
    expect(out).toHaveLength(2)
    expect(out[0]!.path).toBe(newer.getSessionFile() ?? '')
    expect(out[0]!.firstMessage).toContain('second conversation')
    expect(out[0]!.messageCount).toBe(2)
    expect(out[0]!.name).toBeNull() // never named
    expect(out[1]!.path).toBe(older.getSessionFile() ?? '')
    expect(out[1]!.messageCount).toBe(2)
    expect(Number.isNaN(Date.parse(out[0]!.modified))).toBe(false)
})

test('an unreadable session directory degrades to an empty list', async () => {
    const out = await listSessionSummaries(process.cwd(), join(tmpdir(), 'pi-remote-nope-404'))
    expect(out).toEqual([])
})

// ─── withCurrentSession: a brand-new conversation has no file to be scanned ──

test('the active session is listed even before pi has written its file', () => {
    const scanned = [
        {
            path: '/s/old.jsonl',
            name: null,
            firstMessage: 'old',
            modified: '2026-01-01T00:00:00.000Z',
            messageCount: 2
        }
    ]
    const merged = withCurrentSession(scanned, '/s/cur.jsonl')
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({
        path: '/s/cur.jsonl',
        firstMessage: '',
        messageCount: 0,
        unsaved: true
    })
    // Newest-first ordering is the drawer's contract; the live session leads.
    expect(merged[1]).toBe(scanned[0]!)
    // The scan's array is the caller's — the merge must not mutate it.
    expect(scanned).toHaveLength(1)
})

test('a current session the scan already returned is left untouched', () => {
    const scanned = [
        {
            path: '/s/cur.jsonl',
            name: 'named',
            firstMessage: 'hi',
            modified: '2026-01-01T00:00:00.000Z',
            messageCount: 2
        }
    ]
    // Same array identity: no synthesized row, no `unsaved` marker.
    expect(withCurrentSession(scanned, '/s/cur.jsonl')).toBe(scanned)
    // Unknown cwd/session (no path): nothing to add either.
    expect(withCurrentSession(scanned, null)).toBe(scanned)
})

// ─── deleteSessionFile: the scan is the delete allow-list ───────────────────

test('deletes a session file the scan returned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-remote-sessions-del-'))
    const cwd = process.cwd()

    const mgr = SessionManager.create(cwd, dir)
    append(mgr, {role: 'user', content: 'delete me'})
    append(mgr, {role: 'assistant', content: [{type: 'text', text: 'gone'}]})
    const path = mgr.getSessionFile() ?? ''
    expect(existsSync(path)).toBe(true)

    const out = await deleteSessionFile(path, cwd, dir)
    expect(out).toEqual({ok: true})
    expect(existsSync(path)).toBe(false)
    // The sidebar's next scan no longer sees it.
    expect(await listSessionSummaries(cwd, dir)).toEqual([])
})

test('refuses any path the scan never returned', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-remote-sessions-del-'))
    const cwd = process.cwd()

    // A real JSONL file OUTSIDE the session dir: if the helper trusted the
    // caller's path, this would be an arbitrary-file delete.
    const outsideDir = mkdtempSync(join(tmpdir(), 'pi-remote-outside-'))
    const outside = join(outsideDir, 'evil.jsonl')
    writeFileSync(outside, '{}')

    expect(await deleteSessionFile(outside, cwd, dir)).toEqual({
        ok: false,
        reason: 'unknown_session'
    })
    expect(existsSync(outside)).toBe(true)
    // Inside the dir but never a session (pi did not write it): refused too.
    expect(await deleteSessionFile(join(dir, 'nope.jsonl'), cwd, dir)).toEqual({
        ok: false,
        reason: 'unknown_session'
    })
})
