/**
 * Тести парсингу доданих рядків git diff (`lib/diff-added-lines.mjs`).
 */
import { describe, expect, test } from 'vitest'

import { ALL_LINES, addedLinesByFile, isIntroducedLine, parseAddedLines } from '../diff-added-lines.mjs'

const DIFF = [
  'diff --git a/foo.mjs b/foo.mjs',
  '--- a/foo.mjs',
  '+++ b/foo.mjs',
  '@@ -1,0 +2,3 @@',
  '+рядок2',
  '+рядок3',
  '+рядок4',
  '@@ -10,1 +13,1 @@',
  '-старе',
  '+нове'
].join('\n')

describe('parseAddedLines', () => {
  test('кілька hunks → додані рядки', () => {
    const m = parseAddedLines(DIFF)
    expect([...m.get('foo.mjs')].toSorted((a, b) => a - b)).toEqual([2, 3, 4, 13])
  })
  test('hunk без коми (одиничний рядок) → count 1', () => {
    const m = parseAddedLines('+++ b/x.mjs\n@@ -5 +7 @@\n+one')
    expect([...m.get('x.mjs')]).toEqual([7])
  })
  test('видалений файл (+++ /dev/null) ігнорується', () => {
    const m = parseAddedLines('+++ /dev/null\n@@ -1,2 +0,0 @@')
    expect(m.size).toBe(0)
  })
})

describe('addedLinesByFile (ін\'єкований git)', () => {
  test('tracked diff + untracked → ALL', () => {
    const fakeGit = args => {
      if (args[0] === 'diff') return DIFF
      if (args[0] === 'ls-files') return 'new.mjs\n'
      return ''
    }
    const m = addedLinesByFile(['foo.mjs', 'new.mjs'], '/repo', { git: fakeGit })
    expect([...m.get('foo.mjs')].toSorted((a, b) => a - b)).toEqual([2, 3, 4, 13])
    expect(m.get('new.mjs')).toBe(ALL_LINES)
  })
  test('порожній список файлів → порожня мапа', () => {
    expect(addedLinesByFile([], '/repo').size).toBe(0)
  })
})

describe('isIntroducedLine', () => {
  const m = new Map([
    ['foo.mjs', new Set([2, 3])],
    ['new.mjs', ALL_LINES]
  ])
  test('рядок у Set → introduced', () => {
    expect(isIntroducedLine(m, 'foo.mjs', 2)).toBe(true)
    expect(isIntroducedLine(m, 'foo.mjs', 9)).toBe(false)
  })
  test('ALL → будь-який рядок introduced', () => {
    expect(isIntroducedLine(m, 'new.mjs', 999)).toBe(true)
  })
  test('файл поза мапою → не introduced', () => {
    expect(isIntroducedLine(m, 'other.mjs', 1)).toBe(false)
  })
})
