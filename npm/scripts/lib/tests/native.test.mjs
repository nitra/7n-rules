/**
 * Резолвінг napi-аддона `lib/native.mjs`: порядок пошуку (env-override →
 * platform-підпакет → dev-fallback cargo/napi build → помилка з підказкою)
 * і звірка версії DTO-контракту (Р10 спеки) — на ін'єктованих deps, без
 * реального dlopen.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

import { EXPECTED_CONTRACT_VERSION, resolveNativeAddon } from '../native.mjs'

const ADDON_HINT_RE = /rules native addon/
const UNKNOWN_PLATFORM_RE = /win32-x64[\s\S]*N_RULES_NATIVE_ADDON/
const CONTRACT_MISMATCH_RE = /несумісна версія DTO-контракту[\s\S]*аддон=2[\s\S]*очікується=1/

/**
 * Базові deps: відома платформа, нічого не встановлено і не збудовано.
 * @param {Record<string, unknown>} [overrides] точкові заміни полів
 * @returns {Record<string, unknown>} deps для resolveNativeAddon
 */
function baseDeps(overrides = {}) {
  return {
    env: {},
    platform: 'darwin',
    arch: 'arm64',
    existsSync: () => false,
    requireResolve: () => {
      throw new Error('not installed')
    },
    repoRoot: '/repo',
    ...overrides
  }
}

describe('resolveNativeAddon (порядок пошуку)', () => {
  test('N_RULES_NATIVE_ADDON має найвищий пріоритет', () => {
    const p = resolveNativeAddon(baseDeps({ env: { N_RULES_NATIVE_ADDON: '/custom/addon.node' } }))
    expect(p).toBe('/custom/addon.node')
  })

  test('platform-підпакет: резолвиться @7n/rules-<key> з napi-суфіксом', () => {
    const asked = []
    const p = resolveNativeAddon(
      baseDeps({
        requireResolve: id => {
          asked.push(id)
          return `/node_modules/${id}`
        }
      })
    )
    expect(asked).toEqual(['@7n/rules-darwin-arm64/rules-napi.darwin-arm64.node'])
    expect(p).toBe('/node_modules/@7n/rules-darwin-arm64/rules-napi.darwin-arm64.node')
  })

  test('linux-x64 мапиться на суфікс linux-x64-gnu', () => {
    const p = resolveNativeAddon(baseDeps({ platform: 'linux', arch: 'x64', requireResolve: id => `/nm/${id}` }))
    expect(p).toBe('/nm/@7n/rules-linux-x64/rules-napi.linux-x64-gnu.node')
  })

  test('dev-fallback: release-cdylib перемагає debug', () => {
    const p = resolveNativeAddon(baseDeps({ existsSync: () => true }))
    expect(p).toBe('/repo/target/release/librules_napi.dylib')
  })

  test('dev-fallback: на linux шукається .so, а останній кандидат — вивід napi build', () => {
    const seen = []
    expect(() =>
      resolveNativeAddon(
        baseDeps({
          platform: 'linux',
          arch: 'x64',
          existsSync: p => {
            seen.push(p)
            return false
          }
        })
      )
    ).toThrow(ADDON_HINT_RE)
    expect(seen).toEqual([
      '/repo/target/release/librules_napi.so',
      '/repo/target/debug/librules_napi.so',
      '/repo/crates/rules-napi/rules-napi.linux-x64-gnu.node'
    ])
  })

  test('невідома платформа: без підпакета/суфікса — помилка з підказкою про N_RULES_NATIVE_ADDON', () => {
    expect(() => resolveNativeAddon(baseDeps({ platform: 'win32', arch: 'x64' }))).toThrow(UNKNOWN_PLATFORM_RE)
  })
})

describe('loadNative (кеш процесу)', () => {
  // Кеш аддона живе на рівні модуля (одне завантаження на процес) — щоб
  // кожен тест бачив «перший виклик» ізольовано, перезавантажуємо модуль
  // (vi.resetModules) і імпортуємо свіжий інстанс `loadNative` окремо.
  beforeEach(() => {
    vi.resetModules()
  })

  test('перший виклик вантажить через resolve+dlopen, другий віддає кеш', async () => {
    const { loadNative: freshLoadNative } = await import('../native.mjs')
    let dlopens = 0
    const addon = { contractVersion: () => EXPECTED_CONTRACT_VERSION, resolveChangedBase: 'stub' }
    const first = freshLoadNative({
      resolve: () => '/fake/addon.node',
      dlopen: () => {
        dlopens += 1
        return addon
      }
    })
    const second = freshLoadNative({
      resolve: () => {
        throw new Error('не має викликатись — кеш')
      },
      dlopen: () => {
        throw new Error('не має викликатись — кеш')
      }
    })
    expect(first).toBe(addon)
    expect(second).toBe(addon)
    expect(dlopens).toBe(1)
  })

  test('звірка версії контракту: contractVersion() === EXPECTED_CONTRACT_VERSION — ok', async () => {
    const { loadNative: freshLoadNative } = await import('../native.mjs')
    const addon = { contractVersion: () => EXPECTED_CONTRACT_VERSION }
    const loaded = freshLoadNative({
      resolve: () => '/fake/ok-addon.node',
      dlopen: () => addon
    })
    expect(loaded).toBe(addon)
  })

  test('звірка версії контракту: розбіжність версії кидає зрозумілу помилку', async () => {
    const { loadNative: freshLoadNative } = await import('../native.mjs')
    const addon = { contractVersion: () => EXPECTED_CONTRACT_VERSION + 1 }
    expect(() =>
      freshLoadNative({
        resolve: () => '/fake/bad-addon.node',
        dlopen: () => addon
      })
    ).toThrow(CONTRACT_MISMATCH_RE)
  })

  test('звірка версії контракту: розбіжність не кешується — наступний виклик пробує знову', async () => {
    const { loadNative: freshLoadNative } = await import('../native.mjs')
    const badAddon = { contractVersion: () => EXPECTED_CONTRACT_VERSION + 1 }
    expect(() =>
      freshLoadNative({
        resolve: () => '/fake/bad-addon.node',
        dlopen: () => badAddon
      })
    ).toThrow(CONTRACT_MISMATCH_RE)

    const okAddon = { contractVersion: () => EXPECTED_CONTRACT_VERSION }
    const loaded = freshLoadNative({
      resolve: () => '/fake/ok-addon.node',
      dlopen: () => okAddon
    })
    expect(loaded).toBe(okAddon)
  })
})
