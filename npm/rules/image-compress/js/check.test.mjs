/**
 * Тести `check-image-compress` у ізольованих тимчасових каталогах.
 *
 * Покриває лише FS / `.gitignore`-логіку, що лишилася в JS:
 *  - `.n-minify-image.tsv` НЕ у `.gitignore`;
 *  - застарілий `.minify-image-cache.tsv` видалений (з кореня й з `.gitignore`).
 *
 * Перевірка `lint-image` скрипта (канонічний `npx \@nitra/minify-image --src=. --write`,
 * заборона `--avif`, агрегований `lint` з `bun run lint-image`,
 * `@nitra/minify-image` НЕ в залежностях) тепер у Rego
 * (`npm/policy/image_compress/package_json/`).
 *
 * AVIF-генерацію та переписування `.vue`/`.html` тестує `check-image-avif.test.mjs`.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'

import { check } from './check.mjs'
import { withTmpCwd, writeJson } from '../../../scripts/utils/test-helpers.mjs'

/**
 * Створює мінімальний валідний проєкт під image-compress в поточному cwd.
 * @returns {Promise<void>}
 */
async function setupValidImageProject() {
  await writeJson('package.json', { name: 'image-fixture', private: true })
  await writeFile('.gitignore', 'node_modules/\n', 'utf8')
}

describe('check-image-compress', () => {
  test('успіх: чисте дерево без застарілих файлів', async () => {
    await withTmpCwd(async () => {
      await setupValidImageProject()
      expect(await check()).toBe(0)
    })
  })

  test('успіх: `.n-minify-image.tsv` існує і не в .gitignore', async () => {
    await withTmpCwd(async () => {
      await setupValidImageProject()
      await writeFile('.n-minify-image.tsv', 'src/hero.png\tabc123\t1024\t800\n', 'utf8')
      expect(await check()).toBe(0)
    })
  })

  test('помилка: `.n-minify-image.tsv` у .gitignore (має бути в git)', async () => {
    await withTmpCwd(async () => {
      await setupValidImageProject()
      await writeFile('.gitignore', 'node_modules/\n.n-minify-image.tsv\n', 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('помилка: застарілий `.minify-image-cache.tsv` лежить у корені', async () => {
    await withTmpCwd(async () => {
      await setupValidImageProject()
      await writeFile('.minify-image-cache.tsv', 'src/hero.png\t1700000000000\t1024\t800\n', 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('помилка: застарілий рядок `.minify-image-cache.tsv` лишився у .gitignore', async () => {
    await withTmpCwd(async () => {
      await setupValidImageProject()
      await writeFile('.gitignore', 'node_modules/\n.minify-image-cache.tsv\n', 'utf8')
      expect(await check()).toBe(1)
    })
  })
})
