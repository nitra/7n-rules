import { describe, it, expect, vi } from 'vitest'
import { applyMaxTokens, DEFAULT_MAX_TOKENS } from '../pi-max-tokens.mjs'

describe('pi-max-tokens', () => {
  it('wraps agent.streamFn injecting the default maxTokens into stream options', () => {
    const calls = []
    const session = {
      agent: {
        streamFn: (model, context, options) => {
          calls.push(options)
        }
      }
    }

    const returned = applyMaxTokens(session)
    returned.agent.streamFn('m', 'ctx', { signal: 42 })

    expect(returned).toBe(session)
    expect(calls[0]).toMatchObject({ signal: 42, maxTokens: DEFAULT_MAX_TOKENS })
  })

  it('respects an explicit maxTokens override', () => {
    const streamFn = vi.fn()
    const session = { agent: { streamFn } }

    applyMaxTokens(session, 2048)
    session.agent.streamFn('m', 'ctx', {})

    expect(streamFn).toHaveBeenCalledWith('m', 'ctx', { maxTokens: 2048 })
  })

  it('is a safe no-op for sessions without agent.streamFn (injected fakes)', () => {
    const fake = { prompt: vi.fn() }
    expect(applyMaxTokens(fake)).toBe(fake)
    expect(applyMaxTokens(null)).toBe(null)
  })

  it('does not wrap when maxTokens is explicitly falsy', () => {
    const streamFn = vi.fn()
    const session = { agent: { streamFn } }
    applyMaxTokens(session, 0)
    expect(session.agent.streamFn).toBe(streamFn)
  })
})
