/**
 * Тести check-image-compress у ізольованих тимчасових каталогах.
 *
 * Покриває лише валідації конфігурації стиснення:
 * - канонічний `lint-image` (`npx @nitra/minify-image --src=. --write` без `--avif`);
 * - агрегований `lint` має кликати `bun run lint-image`;
 * - `@nitra/minify-image` не у залежностях;
 * - `.n-minify-image.tsv` НЕ у `.gitignore`;
 * - застарілий `.minify-image-cache.tsv` видалений (з кореня й з `.gitignore`).
 *
 * AVIF-генерацію та переписування `.vue`/`.html` тестує `check-image-avif.test.mjs`.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'

import { check } from '../scripts/check-image-compress.mjs'
import { withTmpCwd, writeJson } from './helpers.mjs'

const CANONICAL_LINT_IMAGE = 'npx @nitra/minify-image --src=. --write'

/**
 * Створює мінімальний валідний проєкт під image-compress в поточному cwd.
 * @returns {Promise<void>}
 */
async function setupValidImageProject() {
  await writeJson('package.json', {
    name: 'image-fixture',
    private: true,
    scripts: {
      lint: 'bun run lint-image && oxfmt .',
      'lint-image': CANONICAL_LINT_IMAGE
    }
  })
  await writeFile('.gitignore', 'node_modules/\n', 'utf8')
}

describe('check-image-compress', () => {
  test('успіх: канонічний `--src=. --write` (без --avif) без застарілих файлів', async () => {
    await withTmpCwd(async () => {
      await setupValidImageProject()
      expect(await check()).toBe(0)
    })
  })

  test('успіх: відсутній агрегований `lint` — перевірку пропущено', async () => {
    await withTmpCwd(async () => {
      await setupValidImageProject()
      await writeJson('package.json', {
        name: 'image-fixture',
        private: true,
        scripts: { 'lint-image': CANONICAL_LINT_IMAGE }
      })
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

  test('помилка: відсутній скрипт lint-image', async () => {
    await withTmpCwd(async () => {
      await setupValidImageProject()
      await writeJson('package.json', {
        name: 'image-fixture',
        private: true,
        scripts: { lint: 'oxfmt .' }
      })
      expect(await check()).toBe(1)
    })
  })

  test('помилка: lint-image без --src=.', async () => {
    await withTmpCwd(async () => {
      await setupValidImageProject()
      await writeJson('package.json', {
        name: 'image-fixture',
        private: true,
        scripts: {
          lint: 'bun run lint-image && oxfmt .',
          'lint-image': 'npx @nitra/minify-image --write'
        }
      })
      expect(await check()).toBe(1)
    })
  })

  test('помилка: lint-image без --write', async () => {
    await withTmpCwd(async () => {
      await setupValidImageProject()
      await writeJson('package.json', {
        name: 'image-fixture',
        private: true,
        scripts: {
          lint: 'bun run lint-image && oxfmt .',
          'lint-image': 'npx @nitra/minify-image --src=.'
        }
      })
      expect(await check()).toBe(1)
    })
  })

  test('помилка: lint-image з забороненим --avif (його ставить лише `check image-avif`)', async () => {
    await withTmpCwd(async () => {
      await setupValidImageProject()
      await writeJson('package.json', {
        name: 'image-fixture',
        private: true,
        scripts: {
          lint: 'bun run lint-image && oxfmt .',
          'lint-image': 'npx @nitra/minify-image --src=. --write --avif'
        }
      })
      expect(await check()).toBe(1)
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

  test('помилка: @nitra/minify-image у devDependencies', async () => {
    await withTmpCwd(async () => {
      await setupValidImageProject()
      await writeJson('package.json', {
        name: 'image-fixture',
        private: true,
        scripts: {
          lint: 'bun run lint-image && oxfmt .',
          'lint-image': CANONICAL_LINT_IMAGE
        },
        devDependencies: { '@nitra/minify-image': '^3.0.0' }
      })
      expect(await check()).toBe(1)
    })
  })

  test('помилка: агрегований lint без `bun run lint-image`', async () => {
    await withTmpCwd(async () => {
      await setupValidImageProject()
      await writeJson('package.json', {
        name: 'image-fixture',
        private: true,
        scripts: {
          lint: 'bun run lint-text && oxfmt .',
          'lint-image': CANONICAL_LINT_IMAGE
        }
      })
      expect(await check()).toBe(1)
    })
  })
})
