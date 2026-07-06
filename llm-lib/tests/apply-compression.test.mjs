/**
 * Тести applyCompression mixin: домішування compressContext у streamFn
 * options, no-op без agent, вимикання через N_LLM_COMPRESS=0.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { applyCompression } from '../lib/internal/apply-compression.mjs'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('applyCompression', () => {
  test('стискає context перед оригінальним streamFn', () => {
    const orig = vi.fn()
    const session = { agent: { streamFn: orig } }
    applyCompression(session)
    const bigText = `{\n  "data": "${'x'.repeat(6000)}"\n}`
    const context = {
      messages: [
        { role: 'user', content: [{ type: 'text', text: bigText }] },
        { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        { role: 'user', content: [{ type: 'text', text: 'ще' }] }
      ]
    }
    session.agent.streamFn('model', context, { maxTokens: 5 })
    const passedContext = orig.mock.calls[0][1]
    expect(passedContext).not.toBe(context)
    expect(passedContext.messages[0].content[0].text).toContain('truncated')
    expect(orig.mock.calls[0][2]).toEqual({ maxTokens: 5 })
  })

  test('no-op без agent і для сесій без streamFn', () => {
    const bare = {}
    expect(applyCompression(bare)).toBe(bare)
  })

  test('N_LLM_COMPRESS=0 вимикає стиснення (context проходить незмінним)', () => {
    vi.stubEnv('N_LLM_COMPRESS', '0')
    const orig = vi.fn()
    const session = { agent: { streamFn: orig } }
    applyCompression(session)
    expect(session.agent.streamFn).toBe(orig)
  })
})
