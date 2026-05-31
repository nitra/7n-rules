import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { collectChangedFiles } from '../changed-files.mjs'
import { withTmpDir } from '../../utils/test-helpers.mjs'

function initRepo(dir) {
  spawnSync('git', ['init', '-q', '--initial-branch=main'], { cwd: dir })
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  spawnSync('git', ['config', 'user.name', 't'], { cwd: dir })
  writeFileSync(join(dir, 'base.js'), 'export const a = 1\n', 'utf8')
  spawnSync('git', ['add', '.'], { cwd: dir })
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: dir })
  return dir
}

describe('collectChangedFiles', () => {
  test('modified tracked + untracked', async () => {
    await withTmpDir(async dir => {
      initRepo(dir)
      writeFileSync(join(dir, 'base.js'), 'export const a = 2\n', 'utf8')
      writeFileSync(join(dir, 'new.ts'), 'export const b = 3\n', 'utf8')
      const files = collectChangedFiles(dir)
      expect(files).toContain('base.js')
      expect(files).toContain('new.ts')
    })
  })
  test('чисте дерево → порожньо', async () => {
    await withTmpDir(async dir => { initRepo(dir); expect(collectChangedFiles(dir)).toEqual([]) })
  })
  test('поза git → порожньо', async () => {
    await withTmpDir(async dir => { expect(collectChangedFiles(dir)).toEqual([]) })
  })
})
