import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { lint, checkFileDocComments, isDocCommentTarget } from '../main.mjs'
import { patterns, promoteLineBlock } from '../fix-doc_comments.mjs'

// Фікстури зібрані динамічно, щоб цей файл сам не тригерив власний детектор.
const jsdoc = text => ['/**', ` * ${text}`, ' */'].join('\n')
const lineComment = text => `// ${text}`

let dir
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

/**
 * Створює tmp-проєкт із файлами.
 * @param {Record<string, string>} files відносний шлях → вміст
 * @returns {string} корінь tmp-проєкту
 */
function makeProject(files) {
  dir = mkdtempSync(join(tmpdir(), 'doc-comments-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content)
  }
  return dir
}

describe('check js.doc_comments — детектор', () => {
  test('файл без експортів — поза вимогою', () => {
    expect(checkFileDocComments('const a = 1\n', 'x.mjs')).toEqual([])
  })

  test('header + JSDoc над експортом → чисто', () => {
    const src = [jsdoc('Намір файлу.'), '', jsdoc('Робить X.'), 'export function go() {}', ''].join('\n')
    expect(checkFileDocComments(src, 'x.mjs')).toEqual([])
  })

  test('без header і без JSDoc → два порушення', () => {
    const src = 'export function go() {}\n'
    const v = checkFileDocComments(src, 'x.mjs')
    expect(v.map(x => x.reason).toSorted()).toEqual(['missing-export-doc', 'missing-file-header'])
    expect(v.every(x => !x.data?.promotable)).toBe(true)
  })

  test('//-блок впритул над експортом → promotable', () => {
    const src = [jsdoc('Header.'), '', lineComment('робить X і Y'), 'export function go() {}', ''].join('\n')
    const v = checkFileDocComments(src, 'x.mjs')
    expect(v).toHaveLength(1)
    expect(v[0].reason).toBe('missing-export-doc')
    expect(v[0].data.promotable).toBe(true)
  })

  test('//-блок на початку файлу → promotable header', () => {
    const src = [lineComment('намір файлу'), '', jsdoc('Робить X.'), 'export function go() {}', ''].join('\n')
    const v = checkFileDocComments(src, 'x.mjs')
    expect(v).toHaveLength(1)
    expect(v[0].reason).toBe('missing-file-header')
    expect(v[0].data.promotable).toBe(true)
  })

  test('розрив рядком між //-блоком і експортом → НЕ promotable', () => {
    const src = [jsdoc('Header.'), '', lineComment('десь вище'), '', 'const gap = 1', 'export const a = gap', ''].join(
      '\n'
    )
    const v = checkFileDocComments(src, 'x.mjs')
    expect(v[0].data?.promotable).toBeUndefined()
  })

  test('tests/fixtures/*.d.ts — поза вимогою', () => {
    expect(isDocCommentTarget('src/tests/a.mjs')).toBe(false)
    expect(isDocCommentTarget('a.test.mjs')).toBe(false)
    expect(isDocCommentTarget('types/a.d.ts')).toBe(false)
    expect(isDocCommentTarget('src/a.mjs')).toBe(true)
  })

  test('lint(ctx) із files фільтрує нецільові', async () => {
    const cwd = makeProject({ 'src/a.mjs': 'export const a = 1\n', 'src/a.test.mjs': 'export const t = 1\n' })
    const { violations } = await lint({ cwd, files: ['src/a.mjs', 'src/a.test.mjs'] })
    expect(violations.every(v => v.file === 'src/a.mjs')).toBe(true)
  })
})

describe('fix js.doc_comments — T0 підвищення // → JSDoc', () => {
  test('promoteLineBlock: один рядок і багаторядковий блок', () => {
    expect(promoteLineBlock(lineComment('робить X'), '')).toBe('/** робить X */')
    const multi = [lineComment('перший'), lineComment('другий')].join('\n')
    expect(promoteLineBlock(multi, '')).toBe(['/**', ' * перший', ' * другий', ' */'].join('\n'))
  })

  test('apply: блок над експортом стає JSDoc, детектор чистий', async () => {
    const src = [lineComment('намір файлу'), '', lineComment('робить X'), 'export function go() {}', ''].join('\n')
    const cwd = makeProject({ 'src/a.mjs': src })
    const before = checkFileDocComments(src, 'src/a.mjs').map(v => ({ ...v, file: 'src/a.mjs' }))
    expect(before.some(v => v.data?.promotable)).toBe(true)

    const writes = []
    await patterns[0].apply(before, {
      cwd,
      recordWrite: p => {
        writes.push(p)
      }
    })
    const after = readFileSync(join(cwd, 'src/a.mjs'), 'utf8')
    expect(writes).toHaveLength(1)
    expect(after).toContain('/** намір файлу */')
    expect(after).toContain('/** робить X */')
    expect(checkFileDocComments(after, 'src/a.mjs')).toEqual([])
  })

  test('apply: не-promotable порушення не чіпаються', async () => {
    const src = 'export function go() {}\n'
    const cwd = makeProject({ 'src/a.mjs': src })
    const v = checkFileDocComments(src, 'src/a.mjs').map(x => ({ ...x, file: 'src/a.mjs' }))
    const writes = []
    const res = await patterns[0].apply(v, {
      cwd,
      recordWrite: p => {
        writes.push(p)
      }
    })
    expect(writes).toEqual([])
    expect(res.touchedFiles).toEqual([])
    expect(readFileSync(join(cwd, 'src/a.mjs'), 'utf8')).toBe(src)
  })
})
