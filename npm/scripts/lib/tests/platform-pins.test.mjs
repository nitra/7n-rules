/**
 * Гейт консистентності платформних napi-пінів.
 *
 * Реліз синхронізує три місця: `optionalDependencies` у `npm/package.json`,
 * `version` у маніфестах підпакетів `npm/packages/rules-<платформа>` і
 * резолвлені записи `bun.lock`. Коли синк ламався, розбіжність приходила в main мовчки — CI
 * падав аж на `bun install --frozen-lockfile` у наступному прогоні, і причина
 * («lockfile had changes») нічого не казала про піни. Двічі це коштувало
 * червоного main:
 *
 *   • `bun update <pkg>` із кореня дописував платформні пакети в кореневі
 *     `dependencies` — правка маніфеста не комітилась, отруєний lock комітився;
 *   • `bun update <pkg>` із теки воркспейса ЗАТИРАВ пін на порожній рядок для
 *     платформ, які не ставляться на runner-і (реліз 1.76.0: linux/win32 → "").
 *
 * Тест ловить обидва наслідки одразу і на рівні даних, а не симптому.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

/** Корінь репо від цього файлу: `npm/scripts/lib/tests/` → чотири рівні вгору. */
const repoRoot = join(import.meta.dirname, '../../../..')

/** Платформні пакети napi-аддона — дзеркало матриці build-native у npm-publish.yml. */
const PLATFORM_PACKAGES = ['rules-darwin-arm64', 'rules-linux-x64', 'rules-win32-x64']

/** Точна semver-версія без діапазону: саме таку форму пише крок «Sync platform versions». */
const EXACT_SEMVER = /^\d+\.\d+\.\d+$/

/**
 * @param {string} relativePath шлях від кореня репо.
 * @returns {Record<string, unknown>} розпарсений JSON.
 */
function readJson(relativePath) {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), 'utf8'))
}

describe('платформні піни napi-аддона', () => {
  const rootManifest = readJson('npm/package.json')
  const lockText = readFileSync(join(repoRoot, 'bun.lock'), 'utf8')

  test.each(PLATFORM_PACKAGES)('%s: пін у npm/package.json — точна непорожня версія', pkg => {
    const pin = rootManifest.optionalDependencies?.[`@7n/${pkg}`]
    expect(pin, `@7n/${pkg} має бути в optionalDependencies`).toBeDefined()
    expect(pin, `порожній пін = слід затирання через bun update`).not.toBe('')
    expect(pin).toMatch(EXACT_SEMVER)
  })

  test.each(PLATFORM_PACKAGES)('%s: версія підпакета збігається з піном', pkg => {
    const pin = rootManifest.optionalDependencies?.[`@7n/${pkg}`]
    expect(readJson(`npm/packages/${pkg}/package.json`).version).toBe(pin)
  })

  test.each(PLATFORM_PACKAGES)('%s: bun.lock резолвить рівно цю версію', pkg => {
    const pin = rootManifest.optionalDependencies?.[`@7n/${pkg}`]
    const entry = lockText.split('\n').find(line => line.includes(`"@7n/${pkg}": ["@7n/${pkg}@`))
    expect(entry, `у bun.lock немає резолвленого запису @7n/${pkg}`).toBeDefined()
    expect(entry).toContain(`"@7n/${pkg}@${pin}"`)
  })

  test('кореневий package.json не має dependencies з платформними пакетами', () => {
    // Слід `bun update` із кореня: bun дописує туди те, чого в маніфесті не було.
    const rootPkg = readJson('package.json')
    const stray = Object.keys(rootPkg.dependencies ?? {}).filter(name =>
      PLATFORM_PACKAGES.some(pkg => name === `@7n/${pkg}`)
    )
    expect(stray).toEqual([])
  })
})
