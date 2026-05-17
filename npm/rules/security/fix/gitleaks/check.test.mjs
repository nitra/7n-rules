/**
 * Тести FS-частини правила `security` (security.mdc) у ізольованих тимчасових каталогах.
 *
 * Покриває лише FS-логіку, що лишилася в JS:
 *  - наявність `package.json`;
 *  - наявність `.gitleaks.toml` з `useDefault = true` у блоці `[extend]`.
 *
 * Перевірка `scripts.lint-security` (канонічний виклик gitleaks, входження у агрегований
 * `lint`, заборона `gitleaks` у залежностях) — у Rego (`npm/policy/security/package_json/`).
 */
import { describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'

import { check } from './check.mjs'
import { withTmpCwd, writeJson } from '../../../../scripts/utils/test-helpers.mjs'

const VALID_GITLEAKS_TOML = `title = "Project gitleaks config"

[extend]
useDefault = true

[allowlist]
description = "test"
paths = ['''.*fixtures?/.*''']
`

/**
 * Створює мінімальний валідний проєкт під security в поточному cwd.
 * @returns {Promise<void>}
 */
async function setupValidSecurityProject() {
  await writeJson('package.json', { name: 'sec-fixture', private: true })
  await writeFile('.gitleaks.toml', VALID_GITLEAKS_TOML, 'utf8')
}

describe('check-security (FS)', () => {
  test('успіх: package.json + .gitleaks.toml з useDefault = true', async () => {
    await withTmpCwd(async () => {
      await setupValidSecurityProject()
      expect(await check()).toBe(0)
    })
  })

  test('помилка: немає package.json', async () => {
    await withTmpCwd(async () => {
      await writeFile('.gitleaks.toml', VALID_GITLEAKS_TOML, 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('помилка: немає .gitleaks.toml', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 'sec-fixture', private: true })
      expect(await check()).toBe(1)
    })
  })

  test('помилка: .gitleaks.toml без useDefault = true', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 'sec-fixture', private: true })
      await writeFile('.gitleaks.toml', '[extend]\nuseDefault = false\n', 'utf8')
      expect(await check()).toBe(1)
    })
  })

  test('успіх: useDefault = true з різним whitespace', async () => {
    await withTmpCwd(async () => {
      await writeJson('package.json', { name: 'sec-fixture', private: true })
      await writeFile('.gitleaks.toml', '[extend]\nuseDefault=true\n', 'utf8')
      expect(await check()).toBe(0)
    })
  })
})
