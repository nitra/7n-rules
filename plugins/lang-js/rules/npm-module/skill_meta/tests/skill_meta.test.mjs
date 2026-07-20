import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { ensureDir, withTmpDir, writeJson } from '@7n/rules/scripts/utils/test-helpers.mjs'

/**
 * Запускає detector у whole-repo режимі і повертає кількість порушень.
 * @param {string} dir корінь тимчасового проєкту
 * @returns {Promise<number>} кількість LintViolation
 */
const check = async dir => {
  const res = await lint({ cwd: dir, ruleId: 'npm-module', concernId: 'skill_meta', files: undefined })
  return res.violations.length
}

describe('skill_meta check', () => {
  test('усі скіли з валідним main.json → 0', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'skills', 'fix'))
      await writeJson(join(dir, 'npm', 'skills', 'fix', 'main.json'), { auto: 'завжди', worktree: true })
      await ensureDir(join(dir, 'npm', 'skills', 'lint'))
      await writeJson(join(dir, 'npm', 'skills', 'lint', 'main.json'), { auto: 'завжди', worktree: false })
      expect(await check(dir)).toBe(0)
    })
  })

  test('відсутній main.json → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'skills', 'fix'))
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('залишковий auto.md → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'skills', 'fix'))
      await writeJson(join(dir, 'npm', 'skills', 'fix', 'main.json'), { auto: 'завжди', worktree: true })
      await writeFile(join(dir, 'npm', 'skills', 'fix', 'auto.md'), 'завжди\n', 'utf8')
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('worktree не boolean → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'skills', 'fix'))
      await writeJson(join(dir, 'npm', 'skills', 'fix', 'main.json'), { auto: 'завжди', worktree: 'yes' })
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('auto присутнє, але нерозпізнане → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'skills', 'fix'))
      await writeJson(join(dir, 'npm', 'skills', 'fix', 'main.json'), { auto: 'always', worktree: true })
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('немає npm/skills взагалі → 0 (нема чого валідувати)', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(0)
    })
  })

  test('requireRoot:true без worktree → 0 (валідний in-place root-only скіл)', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'skills', 'taze'))
      await writeJson(join(dir, 'npm', 'skills', 'taze', 'main.json'), {
        auto: 'завжди',
        worktree: false,
        requireRoot: true
      })
      expect(await check(dir)).toBe(0)
    })
  })

  test('requireRoot не boolean → 1', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'skills', 'fix'))
      await writeJson(join(dir, 'npm', 'skills', 'fix', 'main.json'), {
        auto: 'завжди',
        worktree: false,
        requireRoot: 'yes'
      })
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })

  test('worktree:true + requireRoot:false → 1 (суперечність)', async () => {
    await withTmpDir(async dir => {
      await ensureDir(join(dir, 'npm', 'skills', 'fix'))
      await writeJson(join(dir, 'npm', 'skills', 'fix', 'main.json'), {
        auto: 'завжди',
        worktree: true,
        requireRoot: false
      })
      expect(await check(dir)).toBeGreaterThan(0)
    })
  })
})
