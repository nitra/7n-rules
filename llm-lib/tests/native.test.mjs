/**
 * Резолвінг napi-аддона `lib/internal/native.mjs`: порядок пошуку
 * (env-override → platform-підпакет → dev-fallback cargo/napi build →
 * помилка з підказкою) на ін'єктованих deps, без реального dlopen.
 */

import { describe, expect, test } from 'vitest'

import { loadNative, resolveNativeAddon } from '../lib/internal/native.mjs'

const ADDON_HINT_RE = /llm-lib native addon/
const UNKNOWN_PLATFORM_RE = /win32-x64[\s\S]*N_LLM_LIB_NATIVE_ADDON/

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
    expect(seen).toEqual([
      '/repo/target/release/libllm_lib_napi.so',
      '/repo/target/debug/libllm_lib_napi.so',
      '/repo/llm-lib/crates/llm-lib-napi/llm-lib-napi.linux-x64-gnu.node'
    ])
  })

  test('невідома платформа: без підпакета/суфікса — помилка з підказкою про N_LLM_LIB_NATIVE_ADDON', () => {
    expect(() => resolveNativeAddon(baseDeps({ platform: 'win32', arch: 'x64' }))).toThrow(UNKNOWN_PLATFORM_RE)
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
