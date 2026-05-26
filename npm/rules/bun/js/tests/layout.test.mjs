/**
 * Тести `check-bun` у ізольованих тимчасових каталогах.
 *
 * Більшість поведінкових перевірок (linker = "hoisted" у `bunfig.toml`, заборона
 * `packageManager` / `dependencies` у кореневому `package.json`, `devDependencies`
 * лише `@nitra/*`, агрегований `lint`-скрипт) тепер у Rego-полісі під
 * `npm/policy/bun/`. Тут лишилося лише FS / cross-file (`bun.lock`, `bunfig.toml`,
 * заборонені lockfile, інтеграція з `.n-cursor.json:rules`).
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'

import { check } from '../layout.mjs'
import { withTmpCwd, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

// Перевірка дозволених кореневих devDependencies (лише `@nitra/*`) — у rego
// (`npm/policy/bun/package_json/package_json_test.rego`).

describe('check-bun', () => {
  test('успіх: bun.lock, мінімальний package.json', async () => {
    await withTmpCwd(async () => {
      await writeFile('bun.lock', '', 'utf8')
      await writeFile('bunfig.toml', '[install]\nlinker = "hoisted"\n', 'utf8')
      await writeJson('package.json', { name: 't', private: true })
      expect(await check()).toBe(0)
    })
  })

  test('помилка: відсутній bunfig.toml', async () => {
    await withTmpCwd(async () => {
      await writeFile('bun.lock', '', 'utf8')
      await writeJson('package.json', { name: 't', private: true })
      expect(await check()).toBe(1)
    })
  })

  test('помилка: заборонений package-lock.json', async () => {
    await withTmpCwd(async () => {
      await writeFile('bun.lock', '', 'utf8')
      await writeFile('package-lock.json', '{}', 'utf8')
      await writeJson('package.json', { name: 't' })
      expect(await check()).toBe(1)
    })
  })

  test('docker у .n-cursor.json вимагає lint-docker', async () => {
    await withTmpCwd(async () => {
      await writeFile('bun.lock', '', 'utf8')
      await writeFile('bunfig.toml', '[install]\nlinker = "hoisted"\n', 'utf8')
      await writeJson('.n-cursor.json', { rules: ['docker'] })
      await writeJson('package.json', { name: 't', scripts: {} })
      expect(await check()).toBe(1)
    })
  })

  test('docker + lint-docker — OK', async () => {
    await withTmpCwd(async () => {
      await writeFile('bun.lock', '', 'utf8')
      await writeFile('bunfig.toml', '[install]\nlinker = "hoisted"\n', 'utf8')
      await writeJson('.n-cursor.json', { rules: ['docker'] })
      await writeJson('package.json', {
        name: 't',
        scripts: {
          'lint-docker': 'echo',
          lint: 'bun run lint-docker && oxfmt .'
        }
      })
      expect(await check()).toBe(0)
    })
  })

  test('зворотній інваріант: правило k8s відсутнє, але scripts.lint-k8s є → fail', async () => {
    await withTmpCwd(async () => {
      await writeFile('bun.lock', '', 'utf8')
      await writeFile('bunfig.toml', '[install]\nlinker = "hoisted"\n', 'utf8')
      await writeJson('.n-cursor.json', { rules: ['docker'], 'disable-rules': ['k8s'] })
      await writeJson('package.json', {
        name: 't',
        scripts: {
          'lint-docker': 'echo',
          'lint-k8s': 'n-cursor lint-k8s',
          lint: 'bun run lint-docker && oxfmt .'
        }
      })
      expect(await check()).toBe(1)
    })
  })

  test('зворотній інваріант: правило k8s відсутнє, але scripts.lint містить bun run lint-k8s → fail', async () => {
    await withTmpCwd(async () => {
      await writeFile('bun.lock', '', 'utf8')
      await writeFile('bunfig.toml', '[install]\nlinker = "hoisted"\n', 'utf8')
      await writeJson('.n-cursor.json', { rules: ['docker'] })
      await writeJson('package.json', {
        name: 't',
        scripts: {
          'lint-docker': 'echo',
          lint: 'bun run lint-docker && bun run lint-k8s && oxfmt .'
        }
      })
      expect(await check()).toBe(1)
    })
  })

  test('зворотній інваріант: правило k8s відсутнє і ніяких слідів → OK', async () => {
    await withTmpCwd(async () => {
      await writeFile('bun.lock', '', 'utf8')
      await writeFile('bunfig.toml', '[install]\nlinker = "hoisted"\n', 'utf8')
      await writeJson('.n-cursor.json', { rules: ['docker'], 'disable-rules': ['k8s'] })
      await writeJson('package.json', {
        name: 't',
        scripts: {
          'lint-docker': 'echo',
          lint: 'bun run lint-docker && oxfmt .'
        }
      })
      expect(await check()).toBe(0)
    })
  })

  test('multi-owner: достатньо одного активного власника (image-avif) щоб lint-image був дозволений', async () => {
    await withTmpCwd(async () => {
      await writeFile('bun.lock', '', 'utf8')
      await writeFile('bunfig.toml', '[install]\nlinker = "hoisted"\n', 'utf8')
      await writeJson('.n-cursor.json', { rules: ['image-avif'], 'disable-rules': ['image-compress'] })
      await writeJson('package.json', {
        name: 't',
        scripts: {
          'lint-image': 'npx @nitra/minify-image',
          lint: 'bun run lint-image && oxfmt .'
        }
      })
      expect(await check()).toBe(0)
    })
  })

  test('multi-owner: обидва image-* вимкнено, але lint-image у chain → fail', async () => {
    await withTmpCwd(async () => {
      await writeFile('bun.lock', '', 'utf8')
      await writeFile('bunfig.toml', '[install]\nlinker = "hoisted"\n', 'utf8')
      await writeJson('.n-cursor.json', { rules: ['bun'], 'disable-rules': ['image-avif', 'image-compress'] })
      await writeJson('package.json', {
        name: 't',
        scripts: {
          'lint-image': 'npx @nitra/minify-image',
          lint: 'bun run lint-image && oxfmt .'
        }
      })
      expect(await check()).toBe(1)
    })
  })
})
