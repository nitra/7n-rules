/**
 * `test-preflight.mjs` — preflight трьох локальних build-артефактів
 * (rules-napi/rules-cli/wasm-плагіни, доккомент модуля). Усі перевірки —
 * на ін'єктованих deps, без торкання реального `target/`/`npm/wasm-plugins/`
 * цього worktree (той самий DI-мотив, що `native.test.mjs`).
 */
import { describe, expect, test, vi } from 'vitest'

import { SKIP_ENV_VAR, assertTestArtifacts, collectMissingArtifacts } from '../test-preflight.mjs'

/** Два фейкові first-party плагіни — досить, щоб перевірити множинність без реальних Cargo.toml. */
const FAKE_PLUGINS = [
  { name: 'lang-js', crateDir: 'crates/plugin-lang-js' },
  { name: 'ci-github', crateDir: 'crates/plugin-ci-github' }
]

/**
 * Базові deps: усі три артефакти "на місці" — стартова точка для тестів,
 * що вимикають рівно один.
 * @param {Record<string, unknown>} [overrides] точкові заміни полів
 * @returns {Record<string, unknown>} deps для [`collectMissingArtifacts`]
 */
function baseDeps(overrides = {}) {
  return {
    repoRoot: '/repo',
    platform: 'darwin',
    exists: () => true,
    readFile: () => 'name = "plugin-fake"',
    resolveRulesCliBinFn: () => '/repo/target/release/rules-cli',
    plugins: FAKE_PLUGINS,
    wasmPluginsDir: '/repo/npm/wasm-plugins',
    ...overrides
  }
}

describe('collectMissingArtifacts', () => {
  test('усі три артефакти на місці → порожній список', () => {
    expect(collectMissingArtifacts(baseDeps())).toEqual([])
  })

  test('rules-napi відсутній: local build cdylib не знайдено', () => {
    const missing = collectMissingArtifacts(baseDeps({ exists: p => !p.includes('librules_napi') }))
    expect(missing.map(m => m.id)).toEqual(['rules-napi'])
    expect(missing[0].command).toBe('cargo build --release -p rules-napi')
    expect(missing[0].detail).toContain('rules-napi')
  })

  test('rules-cli відсутній: resolveRulesCliBinFn кидає', () => {
    const missing = collectMissingArtifacts(
      baseDeps({
        resolveRulesCliBinFn: () => {
          throw new Error('rules-cli parity: немає збірки бінаря')
        }
      })
    )
    expect(missing.map(m => m.id)).toEqual(['rules-cli'])
    expect(missing[0].command).toBe('cargo build --release -p rules-cli')
    expect(missing[0].detail).toContain('STACK_TRACE_ERROR')
  })

  test('wasm-плагіни: builtin-pins.json відсутній — деталь називає файл', () => {
    const missing = collectMissingArtifacts(baseDeps({ exists: p => !p.endsWith('builtin-pins.json') }))
    expect(missing.map(m => m.id)).toEqual(['wasm-плагіни'])
    expect(missing[0].detail).toContain('builtin-pins.json')
    expect(missing[0].command).toBe('node npm/scripts/build-wasm-plugins.mjs')
  })

  test('wasm-плагіни: конкретні .wasm відсутні — деталь називає ВСІ відсутні плагіни поіменно', () => {
    // Обидва фейкові плагіни дають однаковий stem "plugin_fake.wasm" (спільний
    // фікстурний Cargo.toml) — тож і lang-js, і ci-github мають потрапити в
    // перелік, не лише перший.
    const missing = collectMissingArtifacts(
      baseDeps({
        exists: p => p.endsWith('builtin-pins.json') || !p.endsWith('plugin_fake.wasm')
      })
    )
    expect(missing[0].id).toBe('wasm-плагіни')
    expect(missing[0].detail).not.toContain('builtin-pins.json')
    expect(missing[0].detail).toContain('lang-js')
    expect(missing[0].detail).toContain('ci-github')
  })

  test('усі три відсутні одразу → список довжини 3, у порядку 1→2→3', () => {
    const missing = collectMissingArtifacts(
      baseDeps({
        exists: () => false,
        resolveRulesCliBinFn: () => {
          throw new Error('no bin')
        }
      })
    )
    expect(missing.map(m => m.id)).toEqual(['rules-napi', 'rules-cli', 'wasm-плагіни'])
  })
})

describe('assertTestArtifacts', () => {
  test('нічого не кидає, коли все на місці', () => {
    expect(() => assertTestArtifacts(baseDeps())).not.toThrow()
  })

  test('кидає ОДНЕ повідомлення з УСІМА відсутніми одразу (не по одному)', () => {
    const deps = baseDeps({
      exists: () => false,
      resolveRulesCliBinFn: () => {
        throw new Error('no bin')
      }
    })
    let thrown
    try {
      assertTestArtifacts(deps)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    // Точна команда для КОЖНОГО з трьох — той самий тон, що
    // `wasm-plugin-parity-ci-github.test.mjs` (доккомент модуля): бракує / чому /
    // яка команда.
    expect(thrown.message).toContain('cargo build --release -p rules-napi')
    expect(thrown.message).toContain('cargo build --release -p rules-cli')
    expect(thrown.message).toContain('node npm/scripts/build-wasm-plugins.mjs')
    expect(thrown.message).toContain('3/3')
  })

  test('одна відсутня передумова — повідомлення НЕ згадує команди решти двох', () => {
    const deps = baseDeps({ exists: p => !p.includes('librules_napi') })
    let thrown
    try {
      assertTestArtifacts(deps)
    } catch (error) {
      thrown = error
    }
    expect(thrown.message).toContain('cargo build --release -p rules-napi')
    expect(thrown.message).not.toContain('cargo build --release -p rules-cli')
    expect(thrown.message).not.toContain('build-wasm-plugins.mjs')
    expect(thrown.message).toContain('1/3')
  })

  test(`env ${SKIP_ENV_VAR}=1 — пропускає перевірку і НЕ кидає, навіть коли все відсутнє`, () => {
    /** @type {string[]} */
    const warnings = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(msg => {
      warnings.push(msg)
    })
    expect(() =>
      assertTestArtifacts(
        baseDeps({
          exists: () => false,
          resolveRulesCliBinFn: () => {
            throw new Error('no bin')
          },
          env: { [SKIP_ENV_VAR]: '1' }
        })
      )
    ).not.toThrow()
    // Мовчазний skip суперечив би "fail loud" (CLAUDE.md) — тож навіть явний
    // опт-аут лишає видимий слід у виводі, а не просто нічого не робить.
    expect(warnings.some(msg => msg.includes(SKIP_ENV_VAR))).toBe(true)
    warn.mockRestore()
  })
})
