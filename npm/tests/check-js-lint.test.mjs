/**
 * Допоміжні перевірки та канонічний рядок lint-js для check-js-lint.mjs.
 */
import { describe, expect, test } from 'bun:test'

import {
  CANONICAL_LINT_JS,
  isCanonicalLintJs,
  nitraEslintConfigDeclaresE18eTransitive,
  normalizeLintJsScript,
  verifyOxlintRcE18e
} from '../scripts/check-js-lint.mjs'

describe('normalizeLintJsScript / isCanonicalLintJs', () => {
  test('канонічний lint-js приймається', () => {
    expect(normalizeLintJsScript(`  ${CANONICAL_LINT_JS}  `)).toBe(CANONICAL_LINT_JS)
    expect(isCanonicalLintJs(CANONICAL_LINT_JS)).toBe(true)
  })

  test('oxlint без bunx у локальному скрипті — не канон', () => {
    expect(isCanonicalLintJs('oxlint --fix && bunx eslint --fix . && bunx jscpd .')).toBe(false)
  })

  test('інший порядок або відсутній jscpd — не канон', () => {
    expect(isCanonicalLintJs('bunx eslint --fix . && bunx oxlint --fix && bunx jscpd .')).toBe(false)
    expect(isCanonicalLintJs('bunx oxlint --fix && bunx eslint --fix .')).toBe(false)
  })
})

describe('nitraEslintConfigDeclaresE18eTransitive', () => {
  test('^3.5.0 і workspace — ok; ^3.4.0 — ні', () => {
    expect(nitraEslintConfigDeclaresE18eTransitive('^3.5.0')).toBe(true)
    expect(nitraEslintConfigDeclaresE18eTransitive('workspace:*')).toBe(true)
    expect(nitraEslintConfigDeclaresE18eTransitive('^3.4.3')).toBe(false)
  })
})

describe('verifyOxlintRcE18e', () => {
  test('канонічний фрагмент js-lint — ok', () => {
    const v = verifyOxlintRcE18e({
      jsPlugins: ['@e18e/eslint-plugin'],
      rules: { 'e18e/prefer-includes': 'error' }
    })
    expect(v.ok).toBe(true)
    expect(v.failures).toHaveLength(0)
  })

  test('без jsPlugins або без правила — не ok', () => {
    expect(verifyOxlintRcE18e({ rules: { 'e18e/prefer-includes': 'error' } }).ok).toBe(false)
    expect(verifyOxlintRcE18e({ jsPlugins: ['@e18e/eslint-plugin'], rules: {} }).ok).toBe(false)
    expect(
      verifyOxlintRcE18e({
        jsPlugins: ['@e18e/eslint-plugin'],
        rules: { 'e18e/prefer-includes': 'deny' }
      }).ok
    ).toBe(false)
  })
})
