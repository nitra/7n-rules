/**
 * Допоміжні перевірки для rules/js-lint/check.mjs.
 *
 * Канонічний рядок `lint-js` і мінімальну версію `@nitra/eslint-config` тестує
 * rego-полісі `js_lint.package_json` (див. `npm/policy/js_lint/package_json/package_json_test.rego`).
 */
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

import { OXLINT_CANONICAL_JSON_PATH, verifyOxlintRcAgainstCanonical } from '../tooling.mjs'

const canonicalOxlint = JSON.parse(readFileSync(OXLINT_CANONICAL_JSON_PATH, 'utf8'))

describe('verifyOxlintRcAgainstCanonical', () => {
  test('канон збігається сам із собою', () => {
    const v = verifyOxlintRcAgainstCanonical(canonicalOxlint, canonicalOxlint)
    expect(v.ok).toBe(true)
    expect(v.failures).toHaveLength(0)
  })

  test('інший severity правила — не ok', () => {
    const bad = {
      ...canonicalOxlint,
      rules: { .../** @type {Record<string, string>} */ (canonicalOxlint.rules), eqeqeq: 'off' }
    }
    const v = verifyOxlintRcAgainstCanonical(bad, canonicalOxlint)
    expect(v.ok).toBe(false)
    expect(v.failures.some(f => f.includes('eqeqeq'))).toBe(true)
  })

  test('без jsPlugins як у каноні — не ok', () => {
    const rest = { ...canonicalOxlint }
    delete rest.jsPlugins
    const v = verifyOxlintRcAgainstCanonical(rest, canonicalOxlint)
    expect(v.ok).toBe(false)
  })

  test('мінімальний фрагмент без повного канону — не ok', () => {
    const v = verifyOxlintRcAgainstCanonical(
      {
        jsPlugins: ['@e18e/eslint-plugin'],
        rules: { 'e18e/prefer-includes': 'error' }
      },
      canonicalOxlint
    )
    expect(v.ok).toBe(false)
  })

  test('додаткові локальні ignorePatterns дозволені — ok', () => {
    const extended = {
      ...canonicalOxlint,
      ignorePatterns: [...canonicalOxlint.ignorePatterns, '**/generated/**', '**/dist/**']
    }
    const v = verifyOxlintRcAgainstCanonical(extended, canonicalOxlint)
    expect(v.ok).toBe(true)
    expect(v.failures).toHaveLength(0)
  })

  test('відсутній канонічний патерн в ignorePatterns — не ok', () => {
    const stripped = {
      ...canonicalOxlint,
      ignorePatterns: canonicalOxlint.ignorePatterns.slice(1)
    }
    const v = verifyOxlintRcAgainstCanonical(stripped, canonicalOxlint)
    expect(v.ok).toBe(false)
    expect(v.failures.some(f => f.includes('ignorePatterns'))).toBe(true)
  })

  test('cfg null → помилка про object', () => {
    const v = verifyOxlintRcAgainstCanonical(null, canonicalOxlint)
    expect(v.ok).toBe(false)
    expect(v.failures[0]).toContain('object')
  })

  test('cfg масив → помилка про object', () => {
    const v = verifyOxlintRcAgainstCanonical([], canonicalOxlint)
    expect(v.ok).toBe(false)
    expect(v.failures[0]).toContain('object')
  })

  test('canonical null → внутрішня помилка', () => {
    const v = verifyOxlintRcAgainstCanonical(canonicalOxlint, null)
    expect(v.ok).toBe(false)
    expect(v.failures[0]).toContain('внутрішня помилка')
  })

  test('ignorePatterns у канон не масив → compareOxlintIgnorePatterns без fail', () => {
    const syntheticCanon = { ...canonicalOxlint, ignorePatterns: null }
    const v = verifyOxlintRcAgainstCanonical(canonicalOxlint, syntheticCanon)
    // ignorePatterns: null у канон — compareOxlintIgnorePatterns повертає без fail
    expect(v.ok).toBe(true)
  })

  test('cfg.env з зайвим ключем — різна кількість ключів → не ok', () => {
    const bad = { ...canonicalOxlint, env: { ...canonicalOxlint.env, node: true } }
    const v = verifyOxlintRcAgainstCanonical(bad, canonicalOxlint)
    expect(v.ok).toBe(false)
    expect(v.failures.some(f => f.includes('env'))).toBe(true)
  })

  test('cfg.env.builtin: false замість true — deepEqual fails для вкладеного ключа', () => {
    const bad = { ...canonicalOxlint, env: { builtin: false } }
    const v = verifyOxlintRcAgainstCanonical(bad, canonicalOxlint)
    expect(v.ok).toBe(false)
    expect(v.failures.some(f => f.includes('env'))).toBe(true)
  })
})
