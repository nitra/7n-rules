/**
 * Допоміжні перевірки та канонічний рядок lint-js для check-js-lint.mjs.
 */
import { describe, expect, test } from 'bun:test'

import { CANONICAL_LINT_JS, isCanonicalLintJs, normalizeLintJsScript } from '../scripts/check-js-lint.mjs'

describe('normalizeLintJsScript / isCanonicalLintJs', () => {
  test('канонічний lint-js приймається', () => {
    expect(normalizeLintJsScript(`  ${CANONICAL_LINT_JS}  `)).toBe(CANONICAL_LINT_JS)
    expect(isCanonicalLintJs(CANONICAL_LINT_JS)).toBe(true)
  })

  test('bunx oxlint у локальному скрипті заборонено', () => {
    expect(isCanonicalLintJs('bunx oxlint --fix && bunx eslint --fix . && bunx jscpd .')).toBe(false)
  })

  test('інший порядок або відсутній jscpd — не канон', () => {
    expect(isCanonicalLintJs('bunx eslint --fix . && oxlint --fix && bunx jscpd .')).toBe(false)
    expect(isCanonicalLintJs('oxlint --fix && bunx eslint --fix .')).toBe(false)
  })
})
