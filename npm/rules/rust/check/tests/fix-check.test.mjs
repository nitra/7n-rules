/**
 * Тести T0-codemod `fix-check.mjs` (rust). Реальний `cargo fmt` зав'язаний на cargo-проєкт
 * (перевірено e2e); тут — контракт патерну: test-предикат.
 */
import { describe, expect, test } from 'vitest'
import { patterns } from '../fix-check.mjs'

const P = patterns[0]
const DENY = patterns[1]

describe('rust-cargo-fmt pattern', () => {
  test('id', () => {
    expect(patterns).toHaveLength(2)
    expect(P.id).toBe('rust-cargo-fmt')
  })

  test('test: true на cargo-fmt-violation', () => {
    expect(P.test([{ reason: 'cargo-fmt-violation', message: 'm' }])).toBe(true)
  })

  test('test: false на clippy/інших (clippy не автофіксимо)', () => {
    expect(P.test([{ reason: 'cargo-clippy-violation', message: 'm' }])).toBe(false)
    expect(P.test([])).toBe(false)
  })
})

describe('rust-cargo-deny-init pattern', () => {
  test('id', () => {
    expect(DENY.id).toBe('rust-cargo-deny-init')
  })

  test('test: true на deny-config-missing', () => {
    expect(DENY.test([{ reason: 'deny-config-missing', message: 'm' }])).toBe(true)
  })

  test('test: false на clippy/інших', () => {
    expect(DENY.test([{ reason: 'cargo-clippy-violation', message: 'm' }])).toBe(false)
    expect(DENY.test([])).toBe(false)
  })
})
