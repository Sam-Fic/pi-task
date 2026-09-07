import {expect, test} from 'bun:test'
import {isClientMessage, type ServerMessage, type PromptMessage} from '../../src/remote/protocol.js'

test('isClientMessage accepts a prompt_answer with string value', () => {
    expect(isClientMessage({type: 'prompt_answer', id: '1', value: 'hello'})).toBe(true)
})

test('isClientMessage accepts a prompt_answer with undefined value (cancel)', () => {
    expect(isClientMessage({type: 'prompt_answer', id: '1', value: undefined})).toBe(true)
})

test('isClientMessage accepts a plain message', () => {
    expect(isClientMessage({type: 'message', text: 'hi'})).toBe(true)
})

test('isClientMessage accepts an interrupt (browser Stop button)', () => {
    expect(isClientMessage({type: 'interrupt'})).toBe(true)
})

test('isClientMessage rejects unknown and malformed', () => {
    expect(isClientMessage({type: 'nope'})).toBe(false)
    expect(isClientMessage(null)).toBe(false)
    expect(isClientMessage({type: 'prompt_answer'})).toBe(false) // missing id
})

test('isClientMessage accepts the sidebar frames and rejects an empty switch path', () => {
    expect(isClientMessage({type: 'list_sessions'})).toBe(true)
    expect(isClientMessage({type: 'switch_session', path: '/home/me/.pi/s/x.jsonl'})).toBe(true)
    expect(isClientMessage({type: 'switch_session', path: ''})).toBe(false)
    expect(isClientMessage({type: 'switch_session'})).toBe(false)
})

test('SessionsMessage is part of the ServerMessage union', () => {
    const m: ServerMessage = {
        type: 'sessions',
        current: '/a.jsonl',
        sessions: [
            {
                path: '/a.jsonl',
                name: null,
                firstMessage: 'hi',
                modified: '2026-09-07T00:00:00Z',
                messageCount: 1
            }
        ]
    }
    expect(m.type).toBe('sessions')
})

test('ServerMessage prompt shape is constructable', () => {
    const m: PromptMessage = {
        type: 'prompt',
        id: '7',
        question: 'Which DB?',
        recommended: 'postgres',
        allowSkip: false
    }
    const s: ServerMessage = m
    expect(s.type).toBe('prompt')
})
