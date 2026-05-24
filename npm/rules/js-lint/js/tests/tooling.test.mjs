/**
 * Допоміжні перевірки для rules/js-lint/fix.mjs.
 *
 * Канонічний рядок `lint-js` і мінімальну версію `@nitra/eslint-config` тестує
 * rego-полісі `js_lint.package_json` (див. `npm/policy/js_lint/package_json/package_json_test.rego`).
 */
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import { OXLINT_CANONICAL_JSON_PATH, verifyOxlintRcAgainstCanonical } from '../check.mjs'

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
})
