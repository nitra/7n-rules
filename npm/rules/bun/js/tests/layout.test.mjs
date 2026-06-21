/**
 * Тести `check-bun` у ізольованих тимчасових каталогах.
 *
 * Більшість поведінкових перевірок (linker = "hoisted" у `bunfig.toml`, заборона
 * `packageManager` / `dependencies` у кореневому `package.json`, `devDependencies`
 * лише `@nitra/*`, агрегований `lint`-скрипт) тепер у Rego-полісі під
 * `npm/policy/bun/`. Тут лишилося лише FS / cross-file (`bun.lock`, `bunfig.toml`,
 * заборонені lockfile).
 */
import { describe, expect, test } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { check } from '../layout.mjs'
import { ensureDir, withTmpDir, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

// Перевірка дозволених кореневих devDependencies (лише `@nitra/*`) — у rego
// (`npm/policy/bun/package_json/package_json_test.rego`).

describe('check-bun', () => {
  test('успіх: bun.lock, мінімальний package.json', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'bun.lock'), '', 'utf8')
      await writeFile(join(dir, 'bunfig.toml'), '[install]\nlinker = "hoisted"\n', 'utf8')
      await writeJson(join(dir, 'package.json'), { name: 't', private: true })
      expect(await check(dir)).toBe(0)
    })
  })

  test('помилка: відсутній bunfig.toml', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'bun.lock'), '', 'utf8')
      await writeJson(join(dir, 'package.json'), { name: 't', private: true })
      expect(await check(dir)).toBe(1)
    })
  })

  test('помилка: заборонений package-lock.json', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'bun.lock'), '', 'utf8')
      await writeFile(join(dir, 'package-lock.json'), '{}', 'utf8')
      await writeJson(join(dir, 'package.json'), { name: 't' })
      expect(await check(dir)).toBe(1)
    })
  })

  test('мігровані lint-правила НЕ вимагають package.json scripts', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'bun.lock'), '', 'utf8')
      await writeFile(join(dir, 'bunfig.toml'), '[install]\nlinker = "hoisted"\n', 'utf8')
      await writeJson(join(dir, '.n-cursor.json'), { rules: ['docker', 'k8s', 'image-compress', 'image-avif'] })
      await writeJson(join(dir, 'package.json'), { name: 't', scripts: {} })
      expect(await check(dir)).toBe(0)
    })
  })

  test('помилка: директорія .yarn існує (line 179)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'bun.lock'), '', 'utf8')
      await writeFile(join(dir, 'bunfig.toml'), '[install]\nlinker = "hoisted"\n', 'utf8')
      await ensureDir(join(dir, '.yarn'))
      await writeJson(join(dir, 'package.json'), { name: 't', private: true })
      expect(await check(dir)).toBe(1)
    })
  })

  test('помилка: відсутній bun.lock (line 186)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'bunfig.toml'), '[install]\nlinker = "hoisted"\n', 'utf8')
      await writeJson(join(dir, 'package.json'), { name: 't', private: true })
      expect(await check(dir)).toBe(1)
    })
  })

  test('помилка: відсутній package.json — ранній вихід (lines 199-200)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'bun.lock'), '', 'utf8')
      await writeFile(join(dir, 'bunfig.toml'), '[install]\nlinker = "hoisted"\n', 'utf8')
      expect(await check(dir)).toBe(1)
    })
  })

  test('.n-cursor.json з невалідним JSON — повертає empty (line 48)', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'bun.lock'), '', 'utf8')
      await writeFile(join(dir, 'bunfig.toml'), '[install]\nlinker = "hoisted"\n', 'utf8')
      await writeFile(join(dir, '.n-cursor.json'), 'NOT VALID JSON', 'utf8')
      await writeJson(join(dir, 'package.json'), { name: 't', private: true })
      expect(await check(dir)).toBe(0)
    })
  })
})
