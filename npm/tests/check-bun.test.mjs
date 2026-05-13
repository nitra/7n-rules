/**
 * Тести `check-bun` у ізольованих тимчасових каталогах.
 *
 * Більшість поведінкових перевірок (linker = "hoisted" у `bunfig.toml`, заборона
 * `packageManager` / `dependencies` у кореневому `package.json`, `devDependencies`
 * лише `@nitra/*`, агрегований `lint`-скрипт) тепер у Rego-полісі під
 * `npm/policy/bun/`. Тут лишилося лише FS / cross-file (`bun.lock`, `bunfig.toml`,
 * заборонені lockfile, інтеграція з `.n-cursor.json:rules`).
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'

import { check } from '../scripts/check-bun.mjs'
import { withTmpCwd, writeJson } from './helpers.mjs'

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
})
