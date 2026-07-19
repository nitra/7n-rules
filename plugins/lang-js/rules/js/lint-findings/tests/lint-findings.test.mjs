/**
 * Тести нормалізації/класифікації lint-findings (`js/lint-findings.mjs`).
 */
import { describe, expect, test } from 'vitest'

import { ALL_LINES } from '@7n/rules/scripts/lib/diff-added-lines.mjs'
import { classifyFindings, parseEslint, parseOxlint, renderFindings } from '../main.mjs'

const OXLINT = JSON.stringify({
  diagnostics: [
    {
      message: 'Expected ===',
      code: 'eslint(eqeqeq)',
      filename: '/repo/foo.mjs',
      labels: [{ span: { line: 2, column: 7 } }]
    }
  ]
})
const ESLINT = JSON.stringify([
  { filePath: '/repo/foo.mjs', messages: [{ ruleId: 'no-debugger', line: 9, message: 'debugger not allowed' }] }
])

describe('parseOxlint', () => {
  test('diagnostic → нормалізований finding', () => {
    expect(parseOxlint(OXLINT)).toEqual([
      { file: '/repo/foo.mjs', line: 2, rule: 'eslint(eqeqeq)', message: 'Expected ===', tool: 'oxlint' }
    ])
  })
  test('непарсабельне → null (краш); парсабельне без diagnostics → []', () => {
    expect(parseOxlint('not json')).toBeNull()
    expect(parseOxlint('{}')).toEqual([])
  })
})

describe('parseEslint', () => {
  test('message → нормалізований finding', () => {
    expect(parseEslint(ESLINT)).toEqual([
      { file: '/repo/foo.mjs', line: 9, rule: 'no-debugger', message: 'debugger not allowed', tool: 'eslint' }
    ])
  })
  test('непарсабельне → null; парсабельне без messages → []', () => {
    expect(parseEslint('xxx')).toBeNull()
    expect(parseEslint('[]')).toEqual([])
  })
})

describe('classifyFindings', () => {
  test('рядок у diff → introduced; поза → pre-existing', () => {
    const findings = [
      { file: '/repo/foo.mjs', line: 2, rule: 'a' },
      { file: '/repo/foo.mjs', line: 9, rule: 'b' }
    ]
    const added = new Map([['foo.mjs', new Set([2, 3])]])
    const { introduced, preExisting } = classifyFindings(findings, added, '/repo')
    expect(introduced.map(f => f.rule)).toEqual(['a'])
    expect(preExisting.map(f => f.rule)).toEqual(['b'])
  })
  test('untracked (ALL) → усе introduced', () => {
    const findings = [{ file: '/repo/new.mjs', line: 99, rule: 'x' }]
    const added = new Map([['new.mjs', ALL_LINES]])
    expect(classifyFindings(findings, added, '/repo').introduced).toHaveLength(1)
  })
})

describe('renderFindings', () => {
  test('групи 🆕/🗄 з ліком', () => {
    const out = renderFindings(
      {
        introduced: [{ file: '/repo/foo.mjs', line: 2, rule: 'a', message: 'm' }],
        preExisting: [{ file: '/repo/foo.mjs', line: 9, rule: 'b', message: 'n' }]
      },
      '/repo'
    )
    expect(out).toContain('🆕 introduced (1)')
    expect(out).toContain('🗄 pre-existing (1)')
    expect(out).toContain('foo.mjs:2  a  m')
  })
  test('лише pre-existing → без секції introduced', () => {
    const out = renderFindings({ introduced: [], preExisting: [{ file: 'x.mjs', line: 1, rule: 'r', message: 'm' }] })
    expect(out).not.toContain('🆕')
    expect(out).toContain('🗄 pre-existing (1)')
  })
})
