import { describe, expect, test } from 'vitest'

import { checkFileDocComments, isDocCommentTarget } from '../main.mjs'
import { promoteBlock, patterns } from '../fix-doc_comments.mjs'

// Фікстури зібрані динамічно, щоб файл не тригерив сторонні детектори.
const innerDoc = text => `//! ${text}`
const doc = text => `/// ${text}`
const plain = text => `// ${text}`

describe('check rust.doc_comments — детектор', () => {
  test('файл без pub-елементів — поза вимогою', () => {
    expect(checkFileDocComments('fn private_only() {}\n', 'src/a.rs')).toEqual([])
  })

  test('//!-header + /// над pub → чисто', () => {
    const src = [innerDoc('Намір файлу.'), '', doc('Робить X.'), 'pub fn go() {}', ''].join('\n')
    expect(checkFileDocComments(src, 'src/a.rs')).toEqual([])
  })

  test('без header і без /// → два порушення', () => {
    const src = 'pub fn go() {}\n'
    const v = checkFileDocComments(src, 'src/a.rs')
    expect(v.map(x => x.reason).toSorted()).toEqual(['missing-file-header', 'missing-pub-doc'])
  })

  test('//-блок над pub-елементом → promotable; атрибути між ними пропускаються', () => {
    const src = [innerDoc('H.'), '', plain('робить X'), '#[derive(Debug)]', 'pub struct S {}', ''].join('\n')
    const v = checkFileDocComments(src, 'src/a.rs')
    expect(v).toHaveLength(1)
    expect(v[0].reason).toBe('missing-pub-doc')
    expect(v[0].data.promotable).toBe(true)
  })

  test('провідний //-блок → promotable header', () => {
    const src = [plain('намір'), doc('X.'), 'pub fn go() {}', ''].join('\n')
    const v = checkFileDocComments(src, 'src/a.rs')
    expect(v).toHaveLength(1)
    expect(v[0].reason).toBe('missing-file-header')
    expect(v[0].data.promotable).toBe(true)
    expect(v[0].data.header).toBe(true)
  })

  test('pub-елементи після #[cfg(test)] не скануються', () => {
    const src = [innerDoc('H.'), '#[cfg(test)]', 'pub fn helper_in_tests() {}', ''].join('\n')
    expect(checkFileDocComments(src, 'src/a.rs')).toEqual([])
  })

  test('pub const NAME — kind const; pub const fn — kind fn', () => {
    const src = [innerDoc('H.'), 'pub const MAX: u32 = 1;', 'pub const fn calc() {}', ''].join('\n')
    const v = checkFileDocComments(src, 'src/a.rs')
    expect(v.map(x => x.data.name).toSorted()).toEqual(['MAX', 'calc'])
  })

  test('tests/ і *_test.rs — поза вимогою', () => {
    expect(isDocCommentTarget('tests/a.rs')).toBe(false)
    expect(isDocCommentTarget('src/a_test.rs')).toBe(false)
    expect(isDocCommentTarget('src/a.rs')).toBe(true)
  })
})

describe('fix rust.doc_comments — T0 підвищення', () => {
  test('promoteBlock: // → /// і // → //! зі збереженням відступу', () => {
    const lines = ['  // текст', '// намір']
    promoteBlock(lines, { fromLine: 0, toLine: 0 })
    promoteBlock(lines, { fromLine: 1, toLine: 1, header: true })
    expect(lines).toEqual(['  /// текст', '//! намір'])
  })

  test('apply: блоки підвищено, детектор чистий', async () => {
    const { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'rust-doc-'))
    try {
      const src = [plain('намір файлу'), '', plain('робить X'), 'pub fn go() {}', ''].join('\n')
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'src/a.rs'), src)
      const before = checkFileDocComments(src, 'src/a.rs').map(v => ({ ...v, file: 'src/a.rs' }))
      expect(before.some(v => v.data?.promotable)).toBe(true)

      const writes = []
      await patterns[0].apply(before, {
        cwd: dir,
        recordWrite: p => {
          writes.push(p)
        }
      })
      const after = readFileSync(join(dir, 'src/a.rs'), 'utf8')
      expect(writes).toHaveLength(1)
      expect(after).toContain('//! намір файлу')
      expect(after).toContain('/// робить X')
      expect(checkFileDocComments(after, 'src/a.rs')).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
