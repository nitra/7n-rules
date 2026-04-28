/**
 * Допоміжні перевірки та канонічний рядок lint-js для check-js-lint.mjs.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import {
  CANONICAL_LINT_JS,
  isCanonicalLintJs,
  nitraEslintConfigDeclaresE18eTransitive,
  normalizeLintJsScript,
  OXLINT_CANONICAL_JSON_PATH,
  verifyOxlintRcAgainstCanonical
} from '../scripts/check-js-lint.mjs'

const canonicalOxlint = JSON.parse(readFileSync(OXLINT_CANONICAL_JSON_PATH, 'utf8'))

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
  test('^3.6.12 і workspace — ok; ^3.4.0 — ні', () => {
    expect(nitraEslintConfigDeclaresE18eTransitive('^3.6.12')).toBe(true)
    expect(nitraEslintConfigDeclaresE18eTransitive('workspace:*')).toBe(true)
    expect(nitraEslintConfigDeclaresE18eTransitive('^3.4.3')).toBe(false)
  })
})

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
})
