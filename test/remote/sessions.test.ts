import {mkdtempSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test, expect} from 'bun:test'
import {SessionManager} from '@earendil-works/pi-coding-agent'
import {listSessionSummaries} from '../../src/remote/sessions.js'

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
