import { describe, expect, test } from 'vitest'

import { checkFileDocComments, isDocCommentTarget } from '../main.mjs'
import { buildDocstring, patterns } from '../fix-doc_comments.mjs'

// Фікстури зібрані динамічно: потрійні лапки складаються з частин, щоб файл
// не плутав парсери/лінтери власним умістом.
const tq = '"'.repeat(3)
const docstring = text => `${tq}${text}${tq}`
const hash = text => `# ${text}`

describe('check python.doc_comments — детектор', () => {
  test('файл без публічних def/class — поза вимогою', () => {
    expect(checkFileDocComments('X = 1\n_private = 2\n', 'a.py')).toEqual([])
  })

  test('module-docstring + docstring у def → чисто', () => {
    const src = [docstring('Намір модуля.'), '', 'def go():', `    ${docstring('Робить X.')}`, '    return 1', ''].join(
      '\n'
    )
    expect(checkFileDocComments(src, 'a.py')).toEqual([])
  })

  test('без module-docstring і без docstring → два порушення', () => {
    const src = ['def go():', '    return 1', ''].join('\n')
    const v = checkFileDocComments(src, 'a.py')
    expect(v.map(x => x.reason).toSorted()).toEqual(['missing-def-docstring', 'missing-module-docstring'])
  })

  test('#-блок над def → promotable; декоратори пропускаються', () => {
    const src = [docstring('М.'), '', hash('робить X'), '@cached', 'def go():', '    return 1', ''].join('\n')
    const v = checkFileDocComments(src, 'a.py')
    expect(v).toHaveLength(1)
    expect(v[0].reason).toBe('missing-def-docstring')
    expect(v[0].data.promotable).toBe(true)
  })

  test('_приватні def і class поза вимогою; async def ловиться', () => {
    const src = [
      docstring('М.'),
      '',
      'def _internal():',
      '    return 1',
      '',
      'async def fetch_data():',
      '    return 2',
      ''
    ].join('\n')
    const v = checkFileDocComments(src, 'a.py')
    expect(v).toHaveLength(1)
    expect(v[0].data.name).toBe('fetch_data')
  })

  test('shebang/коментарі/from __future__ перед module-docstring — ок', () => {
    const src = [
      '#!/usr/bin/env python',
      'from __future__ import annotations',
      docstring('Намір.'),
      '',
      'def go():',
      `    ${docstring('X.')}`,
      ''
    ].join('\n')
    expect(checkFileDocComments(src, 'a.py')).toEqual([])
  })

  test('tests/, test_*.py, conftest.py — поза вимогою', () => {
    expect(isDocCommentTarget('tests/a.py')).toBe(false)
    expect(isDocCommentTarget('pkg/test_a.py')).toBe(false)
    expect(isDocCommentTarget('pkg/a_test.py')).toBe(false)
    expect(isDocCommentTarget('conftest.py')).toBe(false)
    expect(isDocCommentTarget('pkg/a.py')).toBe(true)
  })
})

describe('fix python.doc_comments — T0 # → docstring', () => {
  test('buildDocstring: один рядок і багаторядковий', () => {
    expect(buildDocstring(['робить X'], ' '.repeat(4))).toEqual([`    ${docstring('робить X')}`])
    expect(buildDocstring(['перший', 'другий'], '  ')).toEqual([`  ${tq}перший`, '  другий', `  ${tq}`])
  })

  test('apply: #-блок стає docstring-ом, детектор чистий по def', async () => {
    const { mkdtempSync, rmSync, writeFileSync, readFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'py-doc-'))
    try {
      const src = [docstring('М.'), '', hash('робить X'), 'def go():', '    return 1', ''].join('\n')
      writeFileSync(join(dir, 'a.py'), src)
      const before = checkFileDocComments(src, 'a.py').map(v => ({ ...v, file: 'a.py' }))
      expect(before.some(v => v.data?.promotable)).toBe(true)

      const writes = []
      await patterns[0].apply(before, {
        cwd: dir,
        recordWrite: p => {
          writes.push(p)
        }
      })
      const after = readFileSync(join(dir, 'a.py'), 'utf8')
      expect(writes).toHaveLength(1)
      expect(after).toContain(`    ${docstring('робить X')}`)
      expect(after).not.toContain(hash('робить X'))
      expect(checkFileDocComments(after, 'a.py')).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
