/**
 * Резолвінг napi-аддона `lib/internal/native.mjs`: порядок пошуку
 * (env-override → локальна збірка у вихідному дереві → platform-підпакет →
 * локальна збірка поза вихідним деревом → помилка з підказкою) на
 * ін'єктованих deps, без реального dlopen.
 */

import { describe, expect, test, vi } from 'vitest'

import { loadNative, resolveNativeAddon } from '../lib/internal/native.mjs'

const ADDON_HINT_RE = /llm-lib native addon/
/** Усі кандидати ланцюга впали — помилка несе причину ОСТАННЬОЇ спроби. */
const CHAIN_EXHAUSTED_RE = /llm-lib native addon[\s\S]*битий \/b\.node/
const UNKNOWN_PLATFORM_RE = /win32-x64[\s\S]*N_LLM_LIB_NATIVE_ADDON/
/** Маркер вихідного дерева — його наявність перемикає порядок джерел. */
const SOURCE_MARKER = '/repo/llm-lib/crates/llm-lib-napi/Cargo.toml'

/**
 * existsSync, що бачить лише перелічені шляхи.
 * @param {string[]} present наявні шляхи
 * @returns {(p: string) => boolean} предикат
 */
function only(present) {
  return p => present.includes(p)
}

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
  test('N_LLM_LIB_NATIVE_ADDON має найвищий пріоритет', () => {
    const p = resolveNativeAddon(baseDeps({ env: { N_LLM_LIB_NATIVE_ADDON: '/custom/addon.node' } }))
    expect(p).toBe('/custom/addon.node')
  })

  test('platform-підпакет: резолвиться @7n/llm-lib-<key> з napi-суфіксом', () => {
    const asked = []
    const p = resolveNativeAddon(
      baseDeps({
        requireResolve: id => {
          asked.push(id)
          return `/node_modules/${id}`
        }
      })
    )
    expect(asked).toEqual(['@7n/llm-lib-darwin-arm64/llm-lib-napi.darwin-arm64.node'])
    expect(p).toBe('/node_modules/@7n/llm-lib-darwin-arm64/llm-lib-napi.darwin-arm64.node')
  })

  test('linux-x64 мапиться на суфікс linux-x64-gnu', () => {
    const p = resolveNativeAddon(baseDeps({ platform: 'linux', arch: 'x64', requireResolve: id => `/nm/${id}` }))
    expect(p).toBe('/nm/@7n/llm-lib-linux-x64/llm-lib-napi.linux-x64-gnu.node')
  })

  test('dev-fallback: release-cdylib перемагає debug', () => {
    const p = resolveNativeAddon(baseDeps({ existsSync: () => true }))
    expect(p).toBe('/repo/target/release/libllm_lib_napi.dylib')
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
    // Перша перевірка — маркер вихідного дерева (він обирає порядок джерел).
    expect(seen).toEqual([
      SOURCE_MARKER,
      '/repo/target/release/libllm_lib_napi.so',
      '/repo/target/debug/libllm_lib_napi.so',
      '/repo/llm-lib/crates/llm-lib-napi/llm-lib-napi.linux-x64-gnu.node'
    ])
  })

  test('невідома платформа: без підпакета/суфікса — помилка з підказкою про N_LLM_LIB_NATIVE_ADDON', () => {
    expect(() => resolveNativeAddon(baseDeps({ platform: 'win32', arch: 'x64' }))).toThrow(UNKNOWN_PLATFORM_RE)
  })
})

// Симетрично до `npm/scripts/lib/tests/native.test.mjs`: локальна збірка
// перемагає підпакет ЛИШЕ у вихідному дереві, у проді — навпаки (фікс 2026-08-03).
describe('resolveNativeAddon (вихідне дерево vs прод)', () => {
  test('вихідне дерево: локальна збірка перемагає встановлений підпакет', () => {
    const p = resolveNativeAddon(
      baseDeps({
        existsSync: only([SOURCE_MARKER, '/repo/target/release/libllm_lib_napi.dylib']),
        requireResolve: id => `/nm/${id}`
      })
    )
    expect(p).toBe('/repo/target/release/libllm_lib_napi.dylib')
  })

  test('вихідне дерево без локальної збірки: підпакет лишається наступним джерелом', () => {
    const p = resolveNativeAddon(baseDeps({ existsSync: only([SOURCE_MARKER]), requireResolve: id => `/nm/${id}` }))
    expect(p).toBe('/nm/@7n/llm-lib-darwin-arm64/llm-lib-napi.darwin-arm64.node')
  })

  test('продакшен (без вихідних файлів): підпакет перемагає сторонній target/ поруч', () => {
    const p = resolveNativeAddon(
      baseDeps({
        existsSync: only(['/repo/target/release/libllm_lib_napi.dylib']),
        requireResolve: id => `/nm/${id}`
      })
    )
    expect(p).toBe('/nm/@7n/llm-lib-darwin-arm64/llm-lib-napi.darwin-arm64.node')
  })

  test('продакшен без підпакета: локальна збірка лишається останнім fallback-ом', () => {
    const p = resolveNativeAddon(baseDeps({ existsSync: only(['/repo/target/debug/libllm_lib_napi.dylib']) }))
    expect(p).toBe('/repo/target/debug/libllm_lib_napi.dylib')
  })
})

describe('loadNative (кеш процесу)', () => {
  test('перший виклик вантажить через resolve+dlopen, другий віддає кеш', () => {
    let dlopens = 0
    const addon = { oneShotAcp: 'stub' }
    const first = loadNative({
      resolve: () => '/fake/addon.node',
      dlopen: () => {
        dlopens += 1
        return addon
      }
    })
    const second = loadNative({
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
})

/**
 * Регресія 2026-08-04 (PR #376): `existsSync` — не доказ завантажуваності.
 * `gen-tests.test.mjs` мокає `node:fs` так, що `existsSync` завжди `true`;
 * loader вважав неіснуючу локальну збірку валідною і падав `dlopen`-ом
 * замість того, щоб узяти справний підпакет поруч. Тому джерела — ланцюг,
 * і невдалий dlopen веде до наступного кандидата.
 *
 * Кеш модуля глобальний, тож кожен кейс бере свіжий інстанс через
 * `vi.resetModules()` — інакше перший завантажений аддон переміг би решту.
 */
describe('loadNative (ланцюг кандидатів)', () => {
  test('невдалий dlopen першого кандидата → береться наступний', async () => {
    vi.resetModules()
    const fresh = await import('../lib/internal/native.mjs')
    const addon = { oneShotAcp: 'з підпакета' }
    const tried = []
    const got = fresh.loadNative({
      resolveChain: () => ['/repo/target/release/libllm_lib_napi.dylib', '/node_modules/@7n/ok.node'],
      dlopen: p => {
        tried.push(p)
        if (p.includes('target/release')) throw new Error('no such file')
        return addon
      }
    })
    expect(got).toBe(addon)
    expect(tried).toEqual(['/repo/target/release/libllm_lib_napi.dylib', '/node_modules/@7n/ok.node'])
  })

  test('усі кандидати впали → помилка з підказкою і причиною останньої спроби', async () => {
    vi.resetModules()
    const fresh = await import('../lib/internal/native.mjs')
    expect(() =>
      fresh.loadNative({
        resolveChain: () => ['/a.node', '/b.node'],
        dlopen: p => {
          throw new Error(`битий ${p}`)
        }
      })
    ).toThrow(CHAIN_EXHAUSTED_RE)
  })
})
