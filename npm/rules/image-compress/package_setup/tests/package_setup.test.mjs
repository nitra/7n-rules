/**
 * Тести `check-image-compress` у ізольованих тимчасових каталогах.
 *
 * Покриває лише FS / `.gitignore`-логіку, що лишилася в JS:
 *  - `.n-minify-image.tsv` НЕ у `.gitignore`;
 *  - застарілий `.minify-image-cache.tsv` видалений (з кореня й з `.gitignore`).
 *
 * Заборона `@nitra/minify-image` у dependencies/devDependencies лишається у Rego
 * (`npm/rules/image-compress/policy/package_json/`).
 *
 * AVIF-генерацію та переписування `.vue`/`.html` тестує `check-image-avif.test.mjs`.
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { lint } from '../main.mjs'
import { withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

const check = async dir => {
  const r = await lint({ cwd: dir, ruleId: 'image-compress', concernId: 'package_setup', files: undefined })
  return r.violations
}

/**
 * Створює мінімальний валідний проєкт під image-compress у вказаному каталозі.
 * @param {string} dir абсолютний шлях тимчасового каталогу
 * @returns {Promise<void>}
 */
async function setupValidImageProject(dir) {
  await writeJson(join(dir, 'package.json'), { name: 'image-fixture', private: true })
  await writeFile(join(dir, '.gitignore'), 'node_modules/\n', 'utf8')
}

describe('check-image-compress', () => {
  test('успіх: чисте дерево без застарілих файлів', async () => {
    await withTmpDir(async dir => {
      await setupValidImageProject(dir)
      expect(await check(dir)).toEqual([])
    })
  })

  test('успіх: `.n-minify-image.tsv` існує і не в .gitignore', async () => {
    await withTmpDir(async dir => {
      await setupValidImageProject(dir)
      await writeFile(join(dir, '.n-minify-image.tsv'), 'src/hero.png\tabc123\t1024\t800\n', 'utf8')
      expect(await check(dir)).toEqual([])
    })
  })

  test('помилка: `.n-minify-image.tsv` у .gitignore (має бути в git)', async () => {
    await withTmpDir(async dir => {
      await setupValidImageProject(dir)
      await writeFile(join(dir, '.gitignore'), 'node_modules/\n.n-minify-image.tsv\n', 'utf8')
      const violations = await check(dir)
      expect(violations.length).toBeGreaterThan(0)
    })
  })

  test('помилка: застарілий `.minify-image-cache.tsv` лежить у корені', async () => {
    await withTmpDir(async dir => {
      await setupValidImageProject(dir)
      await writeFile(join(dir, '.minify-image-cache.tsv'), 'src/hero.png\t1700000000000\t1024\t800\n', 'utf8')
      const violations = await check(dir)
      expect(violations.length).toBeGreaterThan(0)
    })
  })

  test('помилка: застарілий рядок `.minify-image-cache.tsv` лишився у .gitignore', async () => {
    await withTmpDir(async dir => {
      await setupValidImageProject(dir)
      await writeFile(join(dir, '.gitignore'), 'node_modules/\n.minify-image-cache.tsv\n', 'utf8')
      const violations = await check(dir)
      expect(violations.length).toBeGreaterThan(0)
    })
  })
})
