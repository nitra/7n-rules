import { describe, expect, test } from 'vitest'

import provider from '../provider.mjs'

describe('CoverageProvider (lang-js)', () => {
  test('default-експорт відповідає контракту порту coverage', () => {
    expect(provider.id).toBe('js')
    expect(typeof provider.title).toBe('string')
    expect(typeof provider.detect).toBe('function')
    expect(typeof provider.collect).toBe('function')
    expect(typeof provider.collectPerFile).toBe('function')
  })
})
