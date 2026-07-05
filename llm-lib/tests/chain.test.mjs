/**
 * Тести chain: id-формат, монотонний step, note-агрегація local/cloud,
 * ідемпотентний end, headers/traceFields форма, promptHash-контракт.
 */
import { describe, expect, test, vi } from 'vitest'
import { promptHash, startChain } from '../lib/chain.mjs'

const HEX16_RE = /^[0-9a-f]{16}$/

/**
 * Фабрика chain з інжектами: локальність за префіксом 'omlx/'.
 * @param {object} [over] overrides для startChain-аргументів (зокрема clock)
 * @returns {{ chain: object, trace: import('vitest').Mock }} chain і trace-шпигун
 */
function chainWith(over = {}) {
  const trace = vi.fn()
  const chain = startChain({
    kind: 'fix-concern',
    unit: 'rule/concern',
    cwd: '/proj',
    deps: { trace, isLocal: spec => spec.startsWith('omlx/'), clock: over.clock ?? (() => 1000) },
    ...over
  })
  return { chain, trace }
}

describe('startChain', () => {
  test('id — hex16, step монотонний', () => {
    const { chain } = chainWith()
    expect(chain.id).toMatch(HEX16_RE)
    expect(chain.nextStep()).toBe(1)
    expect(chain.nextStep()).toBe(2)
    expect(chain.traceFields()).toEqual({
      chainId: chain.id,
      chainKind: 'fix-concern',
      chainUnit: 'rule/concern',
      chainStep: 2
    })
  })

  test('note агрегує local/cloud, usage і errors; фінал у end', () => {
    let now = 1000
    const { chain, trace } = chainWith({ clock: () => now })
    chain.nextStep()
    chain.note({ model: 'omlx/gemma', usage: { input: 10, output: 5, totalTokens: 15 }, error: 'boom' })
    chain.nextStep()
    chain.note({ model: 'openai/gpt-5.5', usage: { input: 100, output: 50, totalTokens: 150 } })
    now = 4000
    const summary = chain.end({ outcome: 'success', extra: { t0Applied: false } })

    expect(summary).toMatchObject({
      kind: 'chain',
      chainId: chain.id,
      chainKind: 'fix-concern',
      unit: 'rule/concern',
      cwd: '/proj',
      outcome: 'success',
      steps: 2,
      localCalls: 1,
      cloudCalls: 1,
      escalated: true,
      finalModel: 'openai/gpt-5.5',
      errors: 1,
      wallMs: 3000,
      usage: { input: 110, output: 55, totalTokens: 165 },
      usageCloud: { input: 100, output: 50, totalTokens: 150 },
      extra: { t0Applied: false }
    })
    expect(trace).toHaveBeenCalledTimes(1)
    expect(trace).toHaveBeenCalledWith(summary)
  })

  test('end ідемпотентний — другий виклик без другого запису', () => {
    const { chain, trace } = chainWith()
    const first = chain.end({ outcome: 'fail' })
    const second = chain.end({ outcome: 'success' })
    expect(second).toBe(first)
    expect(second.outcome).toBe('fail')
    expect(trace).toHaveBeenCalledTimes(1)
  })

  test('headers: X-Chain-* з кроком і urlencoded cwd', () => {
    const { chain } = chainWith()
    chain.nextStep()
    expect(chain.headers()).toEqual({
      'X-Chain-Id': chain.id,
      'X-Chain-Step': '1',
      'X-Chain-Kind': 'fix-concern',
      'X-Chain-Cwd': encodeURIComponent('/proj')
    })
  })

  test('без cwd — без X-Chain-Cwd', () => {
    const trace = vi.fn()
    const chain = startChain({ kind: 'k', unit: 'u', deps: { trace } })
    expect(chain.headers()).not.toHaveProperty('X-Chain-Cwd')
    expect(chain.end({ outcome: 'success' }).cwd).toBeNull()
  })

  test('чисто локальний ланцюжок — escalated:false', () => {
    const { chain } = chainWith()
    chain.nextStep()
    chain.note({ model: 'omlx/gemma', usage: { totalTokens: 5 } })
    const s = chain.end({ outcome: 'success' })
    expect(s.escalated).toBe(false)
    expect(s.usageCloud.totalTokens).toBe(0)
  })
})

describe('promptHash', () => {
  test('контракт: sha256 hex16 lowercase від trim(text)', () => {
    expect(promptHash('  hello \n')).toBe(promptHash('hello'))
    expect(promptHash('hello')).toMatch(HEX16_RE)
    // Закріплений вектор для крос-перевірки з Rust-реалізацією myllm:
    // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(promptHash('hello')).toBe('2cf24dba5fb0a30e')
  })

  test('nullish → хеш порожнього рядка, без падіння', () => {
    expect(promptHash()).toBe(promptHash(''))
  })
})
