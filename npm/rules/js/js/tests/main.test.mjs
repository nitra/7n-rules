import { describe, expect, test } from 'vitest'

import { filterJsFiles } from '../../main.mjs'

describe('filterJsFiles', () => {
  test('лишає лише js-подібні розширення', () => {
    expect(filterJsFiles(['a.js', 'b.ts', 'c.vue', 'd.css', 'e.md', 'f.tsx'])).toEqual([
      'a.js',
      'b.ts',
      'c.vue',
      'f.tsx'
    ])
  })
  test('порожній вхід → порожньо', () => {
    expect(filterJsFiles([])).toEqual([])
  })
})
