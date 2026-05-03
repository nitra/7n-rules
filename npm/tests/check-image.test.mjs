/**
 * Тести check-image у ізольованих тимчасових каталогах (split-cache 3.2.0).
 *
 * Покриває: повний успіх, відсутні прапорці `--src=.`/`--write`/`--avif`,
 * `.n-minify-image.tsv` у `.gitignore` (помилка), наявність застарілого
 * `.minify-image-cache.tsv` (помилка), заборона `@nitra/minify-image` у залежностях,
 * AVIF-імпорти у `.vue`. CI-workflow правило не вимагає — лінт зображень тільки локальний.
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { check } from '../scripts/check-image.mjs'
import { ensureDir, withTmpCwd, writeJson } from './helpers.mjs'

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
  await writeFile('.gitignore', 'node_modules/\n', 'utf8')
}

describe('check-image', () => {
  test('успіх: канонічний `--src=. --write --avif` без застарілих файлів', async () => {
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
          'lint-image': 'npx @nitra/minify-image --write --avif'
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

  test('помилка: .vue імпортує raster без .avif (workspace)', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app'],
        scripts: {
          lint: 'bun run lint-image && oxfmt .',
          'lint-image': CANONICAL_LINT_IMAGE
        }
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', { name: 'app' })
      await writeFile(
        join('app/src', 'App.vue'),
        `<script setup>\nimport hero from './hero.png'\n</script>\n<template><img :src="hero"/></template>\n`,
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })

  test('успіх: .vue імпортує `.png.avif`', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app'],
        scripts: {
          lint: 'bun run lint-image && oxfmt .',
          'lint-image': CANONICAL_LINT_IMAGE
        }
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', { name: 'app' })
      await writeFile(
        join('app/src', 'App.vue'),
        `<script setup>\nimport hero from './hero.png.avif'\n</script>\n<template><img :src="hero"/></template>\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('успіх: opt-out `disable-avif` у package.json пакета', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app'],
        scripts: {
          lint: 'bun run lint-image && oxfmt .',
          'lint-image': CANONICAL_LINT_IMAGE
        }
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', {
        name: 'app',
        '@nitra/minify-image': { 'disable-avif': true }
      })
      await writeFile(
        join('app/src', 'App.vue'),
        `<script setup>\nimport hero from './hero.png'\n</script>\n<template><img :src="hero"/></template>\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('успіх: SVG-імпорти у .vue не вимагають avif', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app'],
        scripts: {
          lint: 'bun run lint-image && oxfmt .',
          'lint-image': CANONICAL_LINT_IMAGE
        }
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', { name: 'app' })
      await writeFile(
        join('app/src', 'App.vue'),
        `<script setup>\nimport icon from './icon.svg'\n</script>\n<template><img :src="icon"/></template>\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('помилка: пряме `<img src="...png" />` у шаблоні без імпорту', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app'],
        scripts: {
          lint: 'bun run lint-image && oxfmt .',
          'lint-image': CANONICAL_LINT_IMAGE
        }
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', { name: 'app' })
      await writeFile(
        join('app/src', 'App.vue'),
        `<template>\n  <img src="./hero.png" alt="hero" />\n</template>\n`,
        'utf8'
      )
      expect(await check()).toBe(1)
    })
  })

  test('успіх: пряме `<img src="...png.avif" />` у шаблоні', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app'],
        scripts: {
          lint: 'bun run lint-image && oxfmt .',
          'lint-image': CANONICAL_LINT_IMAGE
        }
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', { name: 'app' })
      await writeFile(
        join('app/src', 'App.vue'),
        `<template>\n  <img src="./hero.png.avif" alt="hero" />\n</template>\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('реактивне `:src="var"` не плутаємо з `src=` (var resolveться через import)', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app'],
        scripts: {
          lint: 'bun run lint-image && oxfmt .',
          'lint-image': CANONICAL_LINT_IMAGE
        }
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', { name: 'app' })
      await writeFile(
        join('app/src', 'App.vue'),
        `<script setup>\nimport hero from './hero.png.avif'\n</script>\n<template>\n  <img :src="hero" />\n</template>\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
    })
  })

  test('правильна деduplication: один звіт навіть коли вкладений workspace під коренем', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app'],
        scripts: {
          lint: 'bun run lint-image && oxfmt .',
          'lint-image': CANONICAL_LINT_IMAGE
        }
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', { name: 'app' })
      await writeFile(
        join('app/src', 'App.vue'),
        `<script setup>\nimport hero from './hero.png'\n</script>\n`,
        'utf8'
      )
      const logs = []
      const origLog = console.log
      console.log = msg => logs.push(String(msg))
      try {
        await check()
      } finally {
        console.log = origLog
      }
      const violationLines = logs.filter(l => l.includes('hero.png'))
      expect(violationLines.length).toBe(1)
    })
  })
})
