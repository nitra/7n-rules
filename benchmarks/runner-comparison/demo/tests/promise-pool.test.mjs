import { describe, it, expect } from 'vitest'
import { promisePool } from '../src/promise-pool.mjs'

describe('promisePool', () => {
  it('non-array → []', async () => {
    expect(await promisePool(null, async x => x)).toEqual([])
  })
  it('empty array → []', async () => {
    expect(await promisePool([], async x => x)).toEqual([])
  })
  it('maps items', async () => {
    expect(await promisePool([1, 2, 3], async x => x * 2)).toEqual([2, 4, 6])
  })
  it('preserves order', async () => {
    const result = await promisePool(
      [5, 1, 3],
      async x => {
        await new Promise(r => setTimeout(r, x))
        return x
      },
      3
    )
    expect(result).toEqual([5, 1, 3])
  })
  it('concurrency 1 = serial', async () => {
    const order = []
    await promisePool(
      [1, 2, 3],
      async x => {
        order.push(`start-${x}`)
        await new Promise(r => setTimeout(r, 5))
        order.push(`end-${x}`)
      },
      1
    )
    expect(order).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3'])
  })
  it('concurrency 0 → coerced to 1', async () => {
    expect(await promisePool([1, 2], async x => x, 0)).toEqual([1, 2])
  })
  it('passes index', async () => {
    expect(await promisePool(['a', 'b'], async (_, i) => i)).toEqual([0, 1])
  })
})
