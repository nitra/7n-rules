import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { check } from '../header_doc_pointer.mjs'
import { ensureDir, withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const MULTI = `/**
 * Довгий наратив рядок перший.
 * Другий рядок.
 * Третій рядок.
 */
`
const POINTER = `/** @see ./docs/applies.md */\n`
const NO_HEADER = `import { foo } from './foo.mjs'\nexport function check() { return 0 }\n`

/**
 * Створює тестовий JS-файл у структурі rules для перевірок header_doc_pointer.
 * @param {string} dir корінь тестового tmp-каталогу
 * @param {string} segment сегмент усередині (rules/skills)
 * @param {string} rule ідентифікатор правила
 * @param {string} stem основа імені файлу без розширення
 * @param {string} content вміст файлу
 * @param {boolean} [hasDocs] чи створити поряд docs/<stem>.md
 * @returns {Promise<void>}
 */
async function mkJs(dir, segment, rule, stem, content, hasDocs = false) {
  const jsDir = join(dir, segment, rule, 'js')
  await ensureDir(jsDir)
  await writeFile(join(jsDir, `${stem}.mjs`), content, 'utf8')
  if (hasDocs) {
    await ensureDir(join(jsDir, 'docs'))
    await writeFile(join(jsDir, 'docs', `${stem}.md`), '# docs\n', 'utf8')
  }
}

describe('header_doc_pointer check', () => {
  test('docs + multi-line header → 1', async () => {
    await withTmpDir(async dir => {
      await mkJs(dir, 'npm/rules', 'foo', 'check', MULTI + NO_HEADER, true)
      expect(await check(dir)).toBe(1)
    })
  })

  test('docs + pointer header (≤1 рядок) → 0', async () => {
    await withTmpDir(async dir => {
      await mkJs(dir, 'npm/rules', 'foo', 'check', POINTER + NO_HEADER, true)
      expect(await check(dir)).toBe(0)
    })
  })

  test('docs + без module JSDoc → 0', async () => {
    await withTmpDir(async dir => {
      await mkJs(dir, 'npm/rules', 'foo', 'check', NO_HEADER, true)
      expect(await check(dir)).toBe(0)
    })
  })

  test('без docs + multi-line header → 0 (без обмежень)', async () => {
    await withTmpDir(async dir => {
      await mkJs(dir, 'npm/rules', 'foo', 'check', MULTI + NO_HEADER, false)
      expect(await check(dir)).toBe(0)
    })
  })

  test('.test.mjs ігнорується навіть з docs', async () => {
    await withTmpDir(async dir => {
      const jsDir = join(dir, 'npm', 'rules', 'foo', 'js')
      await ensureDir(jsDir)
      await writeFile(join(jsDir, 'check.test.mjs'), MULTI + NO_HEADER, 'utf8')
      await ensureDir(join(jsDir, 'docs'))
      await writeFile(join(jsDir, 'docs', 'check.md'), '# docs\n', 'utf8')
      expect(await check(dir)).toBe(0)
    })
  })

  test('npm/skills теж перевіряється', async () => {
    await withTmpDir(async dir => {
      await mkJs(dir, 'npm/skills', 'myscill', 'scan', MULTI + NO_HEADER, true)
      expect(await check(dir)).toBe(1)
    })
  })

  test('немає npm/rules і npm/skills → 0', async () => {
    await withTmpDir(async dir => {
      expect(await check(dir)).toBe(0)
    })
  })

  test('кілька правил: одне ок, одне порушення → 1', async () => {
    await withTmpDir(async dir => {
      await mkJs(dir, 'npm/rules', 'good', 'check', POINTER + NO_HEADER, true)
      await mkJs(dir, 'npm/rules', 'bad', 'check', MULTI + NO_HEADER, true)
      expect(await check(dir)).toBe(1)
    })
  })
})
