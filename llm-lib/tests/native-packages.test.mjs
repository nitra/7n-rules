/**
 * Консистентність платформних підпакетів napi-аддона `llm-lib` з loader-ом
 * `lib/internal/native.mjs`: для кожної v1-платформи (darwin-arm64, linux-x64)
 * `resolveNativeAddon` запитує `@7n/llm-lib-<platform>-<arch>/<артефакт>` — тест
 * звіряє, що відповідний пакет існує в `llm-lib/packages/` з коректними
 * `name`/`files`/`os`/`cpu` і покритий `optionalDependencies` головного пакета.
 * Ловить дрейф між NAPI_SUFFIXES, package.json підпакетів і npm-publish-матрицею.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'
import { resolveNativeAddon } from '../lib/internal/native.mjs'

const LLM_LIB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** @type {Array<{ platform: string, arch: string }>} v1-платформи loader-а */
const V1_PLATFORMS = [
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'linux', arch: 'x64' }
]

/**
 * Ідентифікатор platform-пакета, який loader запитує для платформи
 * (перехоплений через інжектований requireResolve, без реального резолву).
 * @param {string} platform process.platform
 * @param {string} arch process.arch
 * @returns {string} запитаний specifier `@7n/llm-lib-<key>/<артефакт>.node`
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
 * @param {string} relPath шлях від кореня llm-lib
 * @returns {Record<string, unknown> & { files?: string[], os?: string[], cpu?: string[], version?: string, optionalDependencies?: Record<string, string> }} розпарсений package.json
 */
function readPkg(relPath) {
  return JSON.parse(readFileSync(join(LLM_LIB_ROOT, relPath), 'utf8'))
}

describe('платформні підпакети napi-аддона', () => {
  const llmLibPkg = readPkg('package.json')

  for (const { platform, arch } of V1_PLATFORMS) {
    test(`${platform}-${arch}: пакет у packages/ узгоджений із loader-ом і optionalDependencies`, () => {
      const specifier = requestedSubpackage(platform, arch)
      const [scope, pkgDir, artifact] = specifier.split('/')
      const pkgName = `${scope}/${pkgDir}`
      expect(pkgName).toBe(`@7n/llm-lib-${platform}-${arch}`)

      const pkg = readPkg(join('packages', pkgDir.replace('@7n/', ''), 'package.json'))
      expect(pkg.name).toBe(pkgName)
      // Артефакт у files — інакше npm publish відвантажить порожній пакет.
      expect(pkg.files).toContain(artifact)
      // os/cpu — щоб npm/bun ставили підпакет лише на своїй платформі.
      expect(pkg.os).toEqual([platform])
      expect(pkg.cpu).toEqual([arch])
      expect(pkg.publishConfig).toEqual({ access: 'public' })

      // Головний пакет декларує підпакет як optionalDependency у lockstep-версії
      // (плейсхолдер у git; канонічне значення проставляє CI перед publish).
      expect(llmLibPkg.optionalDependencies?.[pkgName]).toBe(pkg.version)
    })
  }
})
