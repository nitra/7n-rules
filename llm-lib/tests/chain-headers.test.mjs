/**
 * Тести chain-headers mixin: домішування X-Chain-* у streamFn options,
 * збереження чужих headers, no-op без chain/без agent.
 */
import { describe, expect, test, vi } from 'vitest'
import { applyChainHeaders } from '../lib/internal/chain-headers.mjs'

const fakeChain = { headers: () => ({ 'X-Chain-Id': 'abc', 'X-Chain-Step': '2' }) }

describe('applyChainHeaders', () => {
  test('домішує заголовки, зберігаючи наявні options.headers', () => {
    const orig = vi.fn()
    const session = { agent: { streamFn: orig } }
    applyChainHeaders(session, fakeChain)
    session.agent.streamFn('m', 'ctx', { maxTokens: 5, headers: { 'X-Other': '1' } })
    expect(orig).toHaveBeenCalledWith('m', 'ctx', {
      maxTokens: 5,
      headers: { 'X-Other': '1', 'X-Chain-Id': 'abc', 'X-Chain-Step': '2' }
    })
  })

  test('headers() читається на момент виклику (свіжий step)', () => {
    const orig = vi.fn()
    const session = { agent: { streamFn: orig } }
    let step = 1
    applyChainHeaders(session, { headers: () => ({ 'X-Chain-Step': String(step) }) })
    session.agent.streamFn('m', 'ctx', {})
    step = 2
    session.agent.streamFn('m', 'ctx', {})
    expect(orig.mock.calls[0][2].headers['X-Chain-Step']).toBe('1')
    expect(orig.mock.calls[1][2].headers['X-Chain-Step']).toBe('2')
  })

  test('no-op без chain і для сесій без agent', () => {
    const orig = vi.fn()
    const session = { agent: { streamFn: orig } }
    expect(applyChainHeaders(session, null)).toBe(session)
    expect(session.agent.streamFn).toBe(orig)
    const bare = {}
    expect(applyChainHeaders(bare, fakeChain)).toBe(bare)
  })
})
