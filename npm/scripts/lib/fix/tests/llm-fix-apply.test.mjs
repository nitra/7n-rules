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

  test('find-fallback: знаходить файл у піддиректорії за basename', async () => {
    await withTmpDir(dir => {
      mkdirSync(join(dir, '.cursor', 'rules'), { recursive: true })
      writeFileSync(join(dir, '.cursor', 'rules', 'main.mdc'), 'CONTENT')
      // передаємо лише basename — файл не в корені
      const files = readFilesForFix(['main.mdc'], dir)
      expect(files).toEqual([{ path: '.cursor/rules/main.mdc', content: 'CONTENT' }])
    })
  })

  test('find-fallback: кілька матчів → ambiguous → пропускає', async () => {
    await withTmpDir(dir => {
      mkdirSync(join(dir, 'a'), { recursive: true })
      mkdirSync(join(dir, 'b'), { recursive: true })
      writeFileSync(join(dir, 'a', 'main.mdc'), 'A')
      writeFileSync(join(dir, 'b', 'main.mdc'), 'B')
      const files = readFilesForFix(['main.mdc'], dir)
      expect(files).toEqual([])
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
