/**
 * Тести guard'а `assertCwdIsProjectRoot`: дозволяє корінь git-репо, блокує
 * піддиректорію, пропускає каталог поза git-репо.
 */
import { describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { assertCwdIsProjectRoot, gitToplevel } from '../assert-project-root.mjs'

/**
 * Створює тимчасовий каталог і ініціалізує в ньому git-репо.
 * @returns {string} realpath кореня нового репо
 */
function initRepo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'n-rules-root-')))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  return dir
}

describe('assertCwdIsProjectRoot', () => {
  test('корінь git-репо → не кидає', () => {
    const repo = initRepo()
    try {
      expect(() => assertCwdIsProjectRoot(repo)).not.toThrow()
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('піддиректорія git-репо → кидає з шляхом кореня', () => {
    const repo = initRepo()
    const sub = join(repo, 'npm', 'bin')
    mkdirSync(sub, { recursive: true })
    try {
      expect(() => assertCwdIsProjectRoot(sub)).toThrow(repo)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  test('каталог поза git-репо → не кидає (корінь невизначений)', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'n-rules-nogit-')))
    try {
      expect(gitToplevel(dir)).toBeNull()
      expect(() => assertCwdIsProjectRoot(dir)).not.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
