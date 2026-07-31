/**
 * Консистентність платформних підпакетів napi-аддона `rules-core` з loader-ом
 * `lib/native.mjs` (за зразком `llm-lib/tests/native-packages.test.mjs`): для
 * кожної v1-платформи (darwin-arm64, linux-x64, win32-x64 — рішення О,
 * §3.4a `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`)
 * `resolveNativeAddon` запитує `@7n/rules-<platform>-<arch>/<артефакт>` —
 * тест звіряє, що відповідний пакет існує в `npm/packages/` з коректними
 * `name`/`files`/`os`/`cpu`/`publishConfig` і покритий `optionalDependencies`
 * головного пакета в lockstep-версії (Р8 спеки
 * `docs/specs/2026-07-30-rules-v2-rust-core-migration.md`). Ловить дрейф між
 * NAPI_SUFFIXES, package.json підпакетів і npm-publish-матрицею (ризик 7 спеки).
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'
import { resolveNativeAddon } from '../native.mjs'

const NPM_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** @type {Array<{ platform: string, arch: string }>} v1-платформи loader-а */
const V1_PLATFORMS = [
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'linux', arch: 'x64' },
  { platform: 'win32', arch: 'x64' }
]

/**
 * Ідентифікатор platform-пакета, який loader запитує для платформи
 * (перехоплений через інжектований requireResolve, без реального резолву).
 * @param {string} platform process.platform
 * @param {string} arch process.arch
 * @returns {string} запитаний specifier `@7n/rules-<key>/<артефакт>.node`
 */
function requestedSubpackage(platform, arch) {
  /** @type {string[]} */
  const requested = []
  resolveNativeAddon({
    env: {},
    platform,
    arch,
    existsSync: () => false,
    requireResolve: id => {
      requested.push(id)
      return id
    }
  })
  expect(requested).toHaveLength(1)
  return requested[0]
}

/**
 * @param {string} relPath шлях від кореня npm
 * @returns {Record<string, unknown> & { files?: string[], os?: string[], cpu?: string[], version?: string, optionalDependencies?: Record<string, string> }} розпарсений package.json
 */
function readPkg(relPath) {
  return JSON.parse(readFileSync(join(NPM_ROOT, relPath), 'utf8'))
}

describe('платформні підпакети napi-аддона rules-core', () => {
  const rulesPkg = readPkg('package.json')

  for (const { platform, arch } of V1_PLATFORMS) {
    test(`${platform}-${arch}: пакет у packages/ узгоджений із loader-ом і optionalDependencies`, () => {
      const specifier = requestedSubpackage(platform, arch)
      const [scope, pkgDir, artifact] = specifier.split('/')
      const pkgName = `${scope}/${pkgDir}`
      expect(pkgName).toBe(`@7n/rules-${platform}-${arch}`)

      const pkg = readPkg(join('packages', pkgDir.replace('@7n/', ''), 'package.json'))
      expect(pkg.name).toBe(pkgName)
      // Артефакт у files — інакше npm publish відвантажить порожній пакет.
      expect(pkg.files).toContain(artifact)
      // os/cpu — щоб npm/bun ставили підпакет лише на своїй платформі.
      expect(pkg.os).toEqual([platform])
      expect(pkg.cpu).toEqual([arch])
      expect(pkg.publishConfig).toEqual({ access: 'public' })

      // Головний пакет декларує підпакет як optionalDependency у lockstep-версії
      // (плейсхолдер у git; канонічне значення проставляє CI перед publish, крок
      // «Sync platform versions to @7n/rules» у npm-publish.yml).
      expect(rulesPkg.optionalDependencies?.[pkgName]).toBe(pkg.version)
    })
  }
})
