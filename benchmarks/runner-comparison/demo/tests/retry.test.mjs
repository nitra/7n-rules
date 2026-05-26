import { describe, it, expect, vi } from 'vitest'
import { retry } from '../src/retry.mjs'

describe('retry', () => {
  it('success on first try', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    expect(await retry(fn)).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('retries until success', async () => {
    let i = 0
    const result = await retry(async () => {
      i += 1
      if (i < 3) throw new Error('boom')
      return 'ok'
    }, { baseDelay: 1 })
    expect(result).toBe('ok')
    expect(i).toBe(3)
  })
  it('throws last error after maxAttempts', async () => {
    let i = 0
    await expect(retry(async () => { i += 1; throw new Error(`e${i}`) }, { maxAttempts: 2, baseDelay: 1 })).rejects.toThrow('e2')
    expect(i).toBe(2)
  })
  it('passes attempt index to fn', async () => {
    const attempts = []
    await retry(async (n) => { attempts.push(n); if (n < 2) throw new Error('x'); return 'ok' }, { baseDelay: 1 })
    expect(attempts).toEqual([0, 1, 2])
  })
  it('default maxAttempts is 3', async () => {
    let i = 0
    await expect(retry(async () => { i += 1; throw new Error('x') }, { baseDelay: 1 })).rejects.toThrow()
    expect(i).toBe(3)
  })
  it('respects baseDelay', async () => {
    const start = Date.now()
    let i = 0
    await retry(async () => { i += 1; if (i < 2) throw new Error('x'); return 'ok' }, { baseDelay: 20, factor: 1 })
    expect(Date.now() - start).toBeGreaterThanOrEqual(15)
  })
  it('exponential factor 2 → delays 10, 20', async () => {
    const start = Date.now()
    let i = 0
    await retry(async () => { i += 1; if (i < 3) throw new Error('x'); return 'ok' }, { baseDelay: 10, factor: 2 })
    expect(Date.now() - start).toBeGreaterThanOrEqual(25)
  })
})
