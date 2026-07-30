import { describe, expect, test } from 'vitest'

import { canonicalHash, canonicalize, loadVersionedCache } from '../deterministic.mjs'

describe('package knowledge deterministic primitives', () => {
  test('orders nested object keys without changing array order', () => {
    expect(canonicalize({ z: [{ b: 2, a: 1 }], a: { d: 4, c: 3 } })).toEqual({
      a: { c: 3, d: 4 },
      z: [{ a: 1, b: 2 }]
    })
  })

  test('hashes equivalent object inputs identically', () => {
    expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }))
  })

  test('normalizes injected cache entries in place at the required version', async () => {
    const cache = { version: 0, entries: [] }

    await expect(loadVersionedCache(undefined, cache, 1)).resolves.toBe(cache)
    expect(cache).toEqual({ version: 1, entries: {} })
  })
})
