/**
 * Тести вбудованого ігнору js/knip для пакетів екосистеми n-rules:
 * unused-dependency issue на \@7n/rules та lang-/ci-плагіни — хибне
 * спрацювання (їх ставить сам npx \@7n/rules, код споживача не імпортує).
 */
import { describe, expect, test } from 'vitest'

import { isNRulesPackageIssue } from '../main.mjs'

describe('isNRulesPackageIssue', () => {
  test('devDependencies-issue на ядро і плагіни — ігнорується', () => {
    for (const pkg of ['@7n/rules', '@7n/rules-lang-js', '@7n/rules-lang-rust', '@7n/rules-ci-github']) {
      expect(isNRulesPackageIssue({ type: 'devDependencies', symbol: pkg })).toBe(true)
      expect(isNRulesPackageIssue({ type: 'dependencies', symbol: pkg })).toBe(true)
    }
  })

  test('чужі пакети й інші типи issue — НЕ ігноруються', () => {
    expect(isNRulesPackageIssue({ type: 'devDependencies', symbol: 'lodash' })).toBe(false)
    expect(isNRulesPackageIssue({ type: 'devDependencies', symbol: '@7n/llm-lib' })).toBe(false)
    expect(isNRulesPackageIssue({ type: 'devDependencies', symbol: '@7n/rulesque' })).toBe(false)
    expect(isNRulesPackageIssue({ type: 'files', symbol: '@7n/rules-lang-js' })).toBe(false)
    expect(isNRulesPackageIssue({ type: 'exports', symbol: '@7n/rules' })).toBe(false)
  })
})
