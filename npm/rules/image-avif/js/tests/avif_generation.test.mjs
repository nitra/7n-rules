/**
 * Тести check-image-avif у ізольованих тимчасових каталогах.
 *
 * Покриває AVIF-етап: pre-scan на raster-посилання у `.vue`/`.html` (порожній → exit 0
 * без `--avif`), генерацію `--avif` (best-effort, у тестах вимкнена через
 * `NITRA_CURSOR_NO_AVIF_RUN=1`), переписування raster-посилань у `.vue`/`.html` на
 * `<...>.avif`, прибирання AVIF-сиріт, опт-аут пакета через
 * `"@nitra/minify-image": { "disable-avif": true }`.
 *
 * Валідації `lint-image`/deps/`.gitignore` тестує `check-image-compress.test.mjs`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from 'node:process'

import { check } from '../avif_generation.mjs'
import { ensureDir, withTmpCwd, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

beforeAll(() => {
  env.NITRA_CURSOR_NO_AVIF_RUN = '1'
})
afterAll(() => {
  delete env.NITRA_CURSOR_NO_AVIF_RUN
})

/** Шукає у тексті App.vue залишок `src="./a.png"` без `.avif` — після rewrite його не має лишатися. */
const ORIGINAL_PNG_SRC_RE = /src="\.\/a\.png"/u

describe('check-image-avif', () => {
  test('помилка: .vue імпортує raster без .avif (workspace)', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app']
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
        workspaces: ['app']
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
        workspaces: ['app']
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
        workspaces: ['app']
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
        workspaces: ['app']
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
        workspaces: ['app']
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
        workspaces: ['app']
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

  test('успіх: статичний `<img src="a.png">` авто-переписується на `.png.avif` коли обидва файли існують', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app']
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', { name: 'app' })
      await writeFile(join('app/src', 'a.png'), 'fake-png', 'utf8')
      await writeFile(join('app/src', 'a.png.avif'), 'fake-avif', 'utf8')
      await writeFile(join('app/src', 'App.vue'), `<template>\n  <img src="./a.png" alt="a" />\n</template>\n`, 'utf8')
      expect(await check()).toBe(0)
      const updated = await readFile(join('app/src', 'App.vue'), 'utf8')
      expect(updated).toContain(`src="./a.png.avif"`)
      expect(updated).not.toMatch(ORIGINAL_PNG_SRC_RE)
      expect(existsSync(join('app/src', 'a.png.avif'))).toBe(true)
    })
  })

  test('успіх: реактивне `:src="dyn"` не тригерить AVIF-етап — orphan лишається до наступного прогону з raster-ref', async () => {
    // Тільки реактивне `:src="..."`, без import/static-src raster-посилань — pre-scan
    // знаходить 0 кандидатів на rewrite, тож AVIF-етап (генерація + rewrite + cleanup)
    // пропускається повністю. Orphan .avif лишається на диску: цей сценарій буде
    // прибраний наступним прогоном, коли в .vue/.html зʼявиться хоча б одне raster.
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app']
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', { name: 'app' })
      await writeFile(join('app/src', 'lonely.png'), 'fake-png', 'utf8')
      await writeFile(join('app/src', 'lonely.png.avif'), 'fake-avif', 'utf8')
      const vue = `<script setup>\nconst dyn = computed(() => '/whatever')\n</script>\n<template>\n  <img :src="dyn" alt="dynamic" />\n</template>\n`
      await writeFile(join('app/src', 'App.vue'), vue, 'utf8')
      expect(await check()).toBe(0)
      expect(await readFile(join('app/src', 'App.vue'), 'utf8')).toBe(vue)
      expect(existsSync(join('app/src', 'lonely.png.avif'))).toBe(true)
      expect(existsSync(join('app/src', 'lonely.png'))).toBe(true)
    })
  })

  test('успіх: змішані форми у одному файлі — переписуються лише покривані', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app']
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', { name: 'app' })
      await writeFile(join('app/src', 'static.png'), 'fake', 'utf8')
      await writeFile(join('app/src', 'static.png.avif'), 'fake', 'utf8')
      await writeFile(join('app/src', 'imp.png'), 'fake', 'utf8')
      await writeFile(join('app/src', 'imp.png.avif'), 'fake', 'utf8')
      await writeFile(join('app/src', 'reactive.png'), 'fake', 'utf8')
      await writeFile(join('app/src', 'reactive.png.avif'), 'fake', 'utf8')
      const vue =
        `<script setup>\n` +
        `import imp from './imp.png'\n` +
        `const url = './reactive.png'\n` +
        `</script>\n` +
        `<template>\n` +
        `  <img src="./static.png" />\n` +
        `  <img :src="imp" />\n` +
        `  <img :src="url" />\n` +
        `  <img data-src="./reactive.png" />\n` +
        `</template>\n`
      await writeFile(join('app/src', 'App.vue'), vue, 'utf8')
      expect(await check()).toBe(0)
      const updated = await readFile(join('app/src', 'App.vue'), 'utf8')
      expect(updated).toContain(`src="./static.png.avif"`)
      expect(updated).toContain(`import imp from './imp.png.avif'`)
      expect(updated).toContain(`const url = './reactive.png'`)
      expect(updated).toContain(`data-src="./reactive.png"`)
      expect(existsSync(join('app/src', 'reactive.png.avif'))).toBe(false)
      expect(existsSync(join('app/src', 'static.png.avif'))).toBe(true)
      expect(existsSync(join('app/src', 'imp.png.avif'))).toBe(true)
    })
  })

  test('успіх: opt-out пакет — AVIF всередині не вважається сиротою і не видаляється', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app']
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', {
        name: 'app',
        '@nitra/minify-image': { 'disable-avif': true }
      })
      await writeFile(join('app/src', 'kept.png'), 'fake-png', 'utf8')
      await writeFile(join('app/src', 'kept.png.avif'), 'fake-avif', 'utf8')
      await writeFile(join('app/src', 'App.vue'), `<template><div/></template>\n`, 'utf8')
      expect(await check()).toBe(0)
      expect(existsSync(join('app/src', 'kept.png.avif'))).toBe(true)
    })
  })

  test('ідемпотентність: другий прогін на чистому стані не змінює файли і не видаляє AVIF', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app']
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', { name: 'app' })
      await writeFile(join('app/src', 'hero.png'), 'fake', 'utf8')
      await writeFile(join('app/src', 'hero.png.avif'), 'fake', 'utf8')
      const vue = `<script setup>\nimport hero from './hero.png.avif'\n</script>\n<template><img :src="hero"/></template>\n`
      await writeFile(join('app/src', 'App.vue'), vue, 'utf8')
      expect(await check()).toBe(0)
      const after1 = await readFile(join('app/src', 'App.vue'), 'utf8')
      expect(after1).toBe(vue)
      expect(existsSync(join('app/src', 'hero.png.avif'))).toBe(true)
      expect(await check()).toBe(0)
      const after2 = await readFile(join('app/src', 'App.vue'), 'utf8')
      expect(after2).toBe(vue)
      expect(existsSync(join('app/src', 'hero.png.avif'))).toBe(true)
    })
  })

  test('успіх: Quasar-style `src="/api-page/1.png"` визначається через `<pkg>/public/...`', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['site']
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('site/src/pages')
      await ensureDir('site/public/api-page')
      await writeJson('site/package.json', { name: 'site' })
      await writeFile(join('site/public/api-page', '1.png'), 'fake', 'utf8')
      await writeFile(join('site/public/api-page', '1.png.avif'), 'fake', 'utf8')
      await writeFile(
        join('site/src/pages', 'x.vue'),
        `<template>\n  <q-img src="/api-page/1.png" />\n</template>\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
      const updated = await readFile(join('site/src/pages', 'x.vue'), 'utf8')
      expect(updated).toContain(`src="/api-page/1.png.avif"`)
      expect(existsSync(join('site/public/api-page', '1.png.avif'))).toBe(true)
    })
  })

  test('успіх: голий шлях у `.html` (`assets/images/x.png`) визначається відносно файла', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['docs']
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('docs/guide/assets/images')
      await writeJson('docs/package.json', { name: 'docs' })
      await writeFile(join('docs/guide/assets/images', 'x.png'), 'fake', 'utf8')
      await writeFile(join('docs/guide/assets/images', 'x.png.avif'), 'fake', 'utf8')
      await writeFile(
        join('docs/guide', 'docs-page.html'),
        `<html><body>\n  <img src="assets/images/x.png" />\n</body></html>\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
      const updated = await readFile(join('docs/guide', 'docs-page.html'), 'utf8')
      expect(updated).toContain(`src="assets/images/x.png.avif"`)
      expect(existsSync(join('docs/guide/assets/images', 'x.png.avif'))).toBe(true)
    })
  })

  test('успіх: `src="start-page-ua/logo.png"` визначається через `<pkg>/public/start-page-ua/logo.png`', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['site']
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('site/src/components/login')
      await ensureDir('site/public/start-page-ua')
      await writeJson('site/package.json', { name: 'site' })
      await writeFile(join('site/public/start-page-ua', 'logo.png'), 'fake', 'utf8')
      await writeFile(join('site/public/start-page-ua', 'logo.png.avif'), 'fake', 'utf8')
      await writeFile(
        join('site/src/components/login', 'X.vue'),
        `<template>\n  <img src="start-page-ua/logo.png" />\n</template>\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
      const updated = await readFile(join('site/src/components/login', 'X.vue'), 'utf8')
      expect(updated).toContain(`src="start-page-ua/logo.png.avif"`)
      expect(existsSync(join('site/public/start-page-ua', 'logo.png.avif'))).toBe(true)
    })
  })

  test('успіх: cleanup не чіпає AVIF у `build/`, `android/`, `ios/`, `.output/`, `.nuxt/`, `.cache/`', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app']
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', { name: 'app' })
      await writeFile(join('app/src', 'App.vue'), `<template><div/></template>\n`, 'utf8')
      for (const dir of ['build', 'android', 'ios', '.output', '.nuxt', '.cache']) {
        await ensureDir(`app/${dir}`)
        await writeFile(join(`app/${dir}`, 'artifact.png.avif'), 'fake', 'utf8')
      }
      expect(await check()).toBe(0)
      for (const dir of ['build', 'android', 'ios', '.output', '.nuxt', '.cache']) {
        expect(existsSync(join(`app/${dir}`, 'artifact.png.avif'))).toBe(true)
      }
    })
  })

  test('успіх: AVIF-сирота поряд з raster-ref в іншому файлі — видаляється під час rewrite-пасу', async () => {
    // Доки в .vue/.html є хоча б одне raster-посилання — pre-scan тригерить повний
    // AVIF-етап, включно з cleanup. Orphan .avif (`orphan.png.avif` без посилань) тоді
    // прибирається, як і раніше. Заодно `usage.png` переписується на `usage.png.avif`.
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app']
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', { name: 'app' })
      await writeFile(join('app/src', 'usage.png'), 'fake-png', 'utf8')
      await writeFile(join('app/src', 'usage.png.avif'), 'fake-avif', 'utf8')
      await writeFile(join('app/src', 'orphan.png'), 'fake-png', 'utf8')
      await writeFile(join('app/src', 'orphan.png.avif'), 'fake-avif', 'utf8')
      await writeFile(join('app/src', 'App.vue'), `<template>\n  <img src="./usage.png" />\n</template>\n`, 'utf8')
      expect(await check()).toBe(0)
      expect(existsSync(join('app/src', 'orphan.png.avif'))).toBe(false)
      expect(existsSync(join('app/src', 'orphan.png'))).toBe(true)
      expect(existsSync(join('app/src', 'usage.png.avif'))).toBe(true)
    })
  })

  test('успіх: raster-імпорт з реальним .avif-сусідом авто-переписується на .avif', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app']
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', { name: 'app' })
      await writeFile(join('app/src', 'hero.png'), 'fake-png', 'utf8')
      await writeFile(join('app/src', 'hero.png.avif'), 'fake-avif', 'utf8')
      await writeFile(
        join('app/src', 'App.vue'),
        `<script setup>\nimport hero from './hero.png'\n</script>\n<template><img :src="hero"/></template>\n`,
        'utf8'
      )
      expect(await check()).toBe(0)
      const updated = await readFile(join('app/src', 'App.vue'), 'utf8')
      expect(updated).toContain(`'./hero.png.avif'`)
      expect(updated).not.toContain(`'./hero.png'`)
      expect(existsSync(join('app/src', 'hero.png.avif'))).toBe(true)
    })
  })

  test('правильна деduplication: один звіт навіть коли вкладений workspace під коренем', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', {
        name: 'mono',
        private: true,
        workspaces: ['app']
      })
      await writeFile('.gitignore', 'node_modules/\n', 'utf8')
      await ensureDir('app/src')
      await writeJson('app/package.json', { name: 'app' })
      await writeFile(join('app/src', 'App.vue'), `<script setup>\nimport hero from './hero.png'\n</script>\n`, 'utf8')
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
