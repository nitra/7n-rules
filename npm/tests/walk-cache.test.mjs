import { beforeEach, describe, expect, test } from 'bun:test'

import { getOrCreateWalkCache, resetWalkCache } from '../scripts/utils/walk-cache.mjs'

describe('walk-cache module singleton', () => {
  beforeEach(() => {
    resetWalkCache()
  })

  test('getOrCreateWalkCache повертає Map', () => {
    expect(getOrCreateWalkCache()).toBeInstanceOf(Map)
  })

  test('повторні виклики повертають той самий instance', () => {
    const a = getOrCreateWalkCache()
    const b = getOrCreateWalkCache()
    expect(a).toBe(b)
  })

  test('resetWalkCache робить новий instance', () => {
    const a = getOrCreateWalkCache()
    a.set('x', Promise.resolve(['a.txt']))
    resetWalkCache()
    const b = getOrCreateWalkCache()
    expect(b).not.toBe(a)
    expect(b.size).toBe(0)
  })

  test('окрема module-instance: при сторонньому скиді — нова Map', () => {
    const before = getOrCreateWalkCache()
    before.set('k', Promise.resolve([]))
    resetWalkCache()
    expect(getOrCreateWalkCache().has('k')).toBe(false)
  })
})
