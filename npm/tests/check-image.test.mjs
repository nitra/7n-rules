/**
 * Тести check-image у ізольованих тимчасових каталогах.
 *
 * Покриває: повний успіх, відсутній скрипт `lint-image`, відсутні прапорці `--src=.`/`--write`/`--avif`,
 * відсутній рядок у `.gitignore`, заборона `@nitra/minify-image` у залежностях,
 * агрегований `lint` без `bun run lint-image`. CI-workflow правило не вимагає — лінт зображень тільки локальний.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'

import { check } from '../scripts/check-image.mjs'
import { withTmpCwd, writeJson } from './helpers.mjs'

const CANONICAL_LINT_IMAGE = 'npx @nitra/minify-image --src=. --write --avif'

/**
 * Створює мінімальний валідний проєкт під image-правило в поточному cwd.
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
  await writeFile('.gitignore', 'node_modules/\n.minify-image-cache.tsv\n', 'utf8')
}

describe('check-image', () => {
  test('успіх: канонічний `--src=. --write --avif`', async () => {
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

  test('успіх: cache у `files` пакета (комітований кеш) замість .gitignore', async () => {
    await withTmpCwd(async () => {
      await setupValidImageProject()
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await writeJson('package.json', {
        name: 'image-fixture',
        private: true,
        files: ['src', '.minify-image-cache.tsv'],
        scripts: {
          lint: 'bun run lint-image && oxfmt .',
          'lint-image': CANONICAL_LINT_IMAGE
        }
      })
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
          'lint-image': 'npx @nitra/minify-image --write --avif'
        }
      })
      expect(await check()).toBe(1)
    })
  })

  test('помилка: lint-image без --write (estimate-режим тепер недостатньо)', async () => {
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

  test('помилка: lint-image без --avif', async () => {
    await withTmpCwd(async () => {
      await setupValidImageProject()
      await writeJson('package.json', {
        name: 'image-fixture',
        private: true,
        scripts: {
          lint: 'bun run lint-image && oxfmt .',
          'lint-image': 'npx @nitra/minify-image --src=. --write'
        }
      })
      expect(await check()).toBe(1)
    })
  })

  test('помилка: відсутній рядок у .gitignore і не у `files`', async () => {
    await withTmpCwd(async () => {
      await setupValidImageProject()
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
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
