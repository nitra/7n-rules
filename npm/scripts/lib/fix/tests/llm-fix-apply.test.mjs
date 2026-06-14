import { describe, expect, test } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'
import { applyChanges, parseChangesResponse, readFilesForFix } from '../llm-fix-apply.mjs'

describe('parseChangesResponse', () => {
  test('прямий JSON', () => {
    expect(parseChangesResponse('{"changes":[{"path":"a.md","content":"x"}]}')).toEqual({
      changes: [{ path: 'a.md', content: 'x' }]
    })
  })
  test('JSON у ```json-блоці```', () => {
    expect(parseChangesResponse('тут фікс:\n```json\n{"changes":[]}\n```\n')).toEqual({ changes: [] })
  })
  test('перший {…}-блок серед тексту', () => {
    expect(parseChangesResponse('blah {"changes":[],"error":"none"} tail')).toEqual({ changes: [], error: 'none' })
  })
  test('невалідне → null', () => {
    expect(parseChangesResponse('no json here')).toBeNull()
  })
})

describe('readFilesForFix', () => {
  test('читає наявні, пропускає відсутні', async () => {
    await withTmpDir(dir => {
      writeFileSync(join(dir, 'a.txt'), 'AAA')
      const files = readFilesForFix(['a.txt', 'missing.txt'], dir)
      expect(files).toEqual([{ path: 'a.txt', content: 'AAA' }])
    })
  })
})

describe('applyChanges', () => {
  test('пише повний вміст; ігнорує неповні записи', async () => {
    await withTmpDir(dir => {
      mkdirSync(join(dir, 'sub'), { recursive: true })
      const res = applyChanges(
        [
          { path: 'sub/a.txt', content: 'new' },
          { path: 'b.txt' }, // без content — пропустити
          { content: 'orphan' } // без path — пропустити
        ],
        dir
      )
      expect(res).toEqual({ ok: true })
      expect(readFileSync(join(dir, 'sub/a.txt'), 'utf8')).toBe('new')
    })
  })
})
