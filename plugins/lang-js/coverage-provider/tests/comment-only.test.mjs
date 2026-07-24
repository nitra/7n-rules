import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { isCommentOnlyChange } from '../lib/comment-only.mjs'

const SRC = 'export function add(a, b) {\n  if (a > 0) return a + b\n  return b\n}\n'

describe('isCommentOnlyChange', () => {
  let dir

  /**
   * git-виклик у тест-репо.
   * @param {string[]} args аргументи git
   * @returns {void}
   */
  function git(...args) {
    spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  }

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'comment-only-')))
    git('init', '-q', '-b', 'main')
    mkdirSync(join(dir, 'src'))
    writeFileSync(join(dir, 'src', 'a.mjs'), SRC)
    git('add', '.')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init')
    git('checkout', '-qb', 'feature')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  test('лише доданий JSDoc/коментар → true', () => {
    writeFileSync(join(dir, 'src', 'a.mjs'), `/** Додає числа. */\n${SRC}`)
    expect(isCommentOnlyChange(dir, 'src/a.mjs')).toBe(true)
  })

  test('зміна форматування без зміни коду → true', () => {
    writeFileSync(join(dir, 'src', 'a.mjs'), SRC.replaceAll('  ', '\t'))
    expect(isCommentOnlyChange(dir, 'src/a.mjs')).toBe(true)
  })

  test('реальна зміна коду → false', () => {
    writeFileSync(join(dir, 'src', 'a.mjs'), SRC.replace('a + b', 'a - b'))
    expect(isCommentOnlyChange(dir, 'src/a.mjs')).toBe(false)
  })

  test('зміна рядкового літерала з // усередині → false (AST-порівняння не веде на регекс-пастку)', () => {
    const withUrl = "export const U = 'https://a.example'\n"
    writeFileSync(join(dir, 'src', 'u.mjs'), withUrl)
    git('add', '.')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'url')
    writeFileSync(join(dir, 'src', 'u.mjs'), withUrl.replace('a.example', 'b.example'))
    expect(isCommentOnlyChange(dir, 'src/u.mjs')).toBe(false)
  })

  test('новий файл (нема в base) → false', () => {
    writeFileSync(join(dir, 'src', 'new.mjs'), SRC)
    expect(isCommentOnlyChange(dir, 'src/new.mjs')).toBe(false)
  })

  test('поза git-репо → false', () => {
    const plain = mkdtempSync(join(tmpdir(), 'no-git-'))
    try {
      writeFileSync(join(plain, 'a.mjs'), SRC)
      expect(isCommentOnlyChange(plain, 'a.mjs')).toBe(false)
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })
})
