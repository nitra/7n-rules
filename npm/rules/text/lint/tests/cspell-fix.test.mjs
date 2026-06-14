import { describe, expect, test } from 'vitest'

import { groupFindingsByFile } from '../cspell-fix.mjs'

describe('groupFindingsByFile', () => {
  test('групує рядки Unknown word за файлом', () => {
    const out = [
      'docs/a.md:3:5 - Unknown word (teh)',
      'docs/a.md:7:1 - Unknown word (quik)',
      'src/b.ts:10:2 - Unknown word (jumpps)',
      '1/1 files (no errors)' // не-finding рядок — ігнорувати
    ].join('\n')
    const m = groupFindingsByFile(out)
    expect([...m.keys()]).toEqual(['docs/a.md', 'src/b.ts'])
    expect(m.get('docs/a.md')).toHaveLength(2)
    expect(m.get('src/b.ts')).toEqual(['src/b.ts:10:2 - Unknown word (jumpps)'])
  })
  test('порожній вивід → порожня мапа', () => {
    expect(groupFindingsByFile('').size).toBe(0)
  })
})
