/**
 * Гейт «замикання обходу `declared_worlds`» (крок 6 спеки
 * `docs/specs/2026-08-31-plugin-contract-v5.md` §8, продовження кроку 5
 * `crates/rules-napi/src/lib.rs`): доводить у ПРОДУКТОВОМУ napi-шляху ту
 * саму пару фактів, що `crates/rules-plugin-host/tests/caps_file_reader_gate.rs`
 * доводить на рівні `PluginHost` —
 *
 * - гість БЕЗ вбудованого маніфесту (custom-section відсутня) — `declared_worlds`
 *   гучно відмовляє, НЕ мовчазний фолбек на порожній/константний список;
 * - той самий скомпільований `plugin_lang_js.wasm` (реально імпортує
 *   `n-rules:caps/file-reader@1.0.0` — крок 5, PR #621, T0-фікс
 *   `bun/package_json`), з маніфестом, що НЕ декларує цей world, — падає на
 *   ІНСТАНЦІАЦІЇ (компонент структурно вимагає імпорт, лінкер його не несе),
 *   не мовчки деградує;
 * - той самий компонент, з маніфестом, що ДЕКЛАРУЄ file-reader (`n-rules
 *   plugin embed-manifest` зі СПРАВЖНЬОГО `crates/plugin-lang-js/plugin.toml`,
 *   той самий крок, що `npm/scripts/build-wasm-plugins.mjs` тепер робить на
 *   збірці) — інстанціюється й `wasmPluginManifest` повертає задекларовані
 *   `worlds`.
 *
 * Третій сценарій (маніфест БЕЗ `n-rules:caps/file-reader@1.0.0`, хоча
 * компонент реально його імпортує) будується без нового wasm-guest-а:
 * `n-rules plugin embed-manifest` читає `worlds` із КОРЕНЕВОГО `plugin.toml`
 * переданого `--crate-dir`, тож фейковий crate-dir із `worlds = []` і
 * власним мінімальним `../rules-contract/wit/world.wit` (лише рядок
 * `package n-rules:plugin@5.0.0;`, все, що читає `read_world_publisher_id`)
 * дає РІВНО той самий ефект, що гість, який «забув» задекларувати world —
 * без реальної другої wasi-sdk-збірки.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, test } from 'vitest'

import { loadNative } from '../../native.mjs'
import { realRepoRoot, resolveRulesCliBin, withTmpDir } from '../../../utils/test-helpers.mjs'

const REPO_ROOT = realRepoRoot()
const RAW_WASM_PATH = join(REPO_ROOT, 'target', 'wasm32-wasip3', 'release', 'plugin_lang_js.wasm')
const REAL_CRATE_DIR = join(REPO_ROOT, 'crates', 'plugin-lang-js')

if (!existsSync(RAW_WASM_PATH)) {
  throw new Error(
    `wasm-declared-worlds-gate.test.mjs: wasm-компонент plugin-lang-js не зібраний: ${RAW_WASM_PATH} відсутній.\n` +
      'Зберіть його командою: bash crates/plugin-lang-js/build.sh'
  )
}

/**
 * Запускає `n-rules plugin embed-manifest --crate-dir <crateDir> --package
 * <name> --component <componentPath>` (на місці) реальним зібраним бінарем
 * — [`resolveRulesCliBin`], той самий каскад, що `npm/scripts/build-wasm-plugins.mjs`.
 * @param {string} crateDir абсолютний шлях крейта-джерела `worlds`/`domains`/`Cargo.toml`
 * @param {string} name package-суфікс
 * @param {string} componentPath абсолютний шлях `.wasm`, вбудовується НА МІСЦІ
 * @returns {void}
 */
function embedManifest(crateDir, name, componentPath) {
  const result = spawnSync(
    resolveRulesCliBin(),
    ['plugin', 'embed-manifest', '--crate-dir', crateDir, '--package', name, '--component', componentPath],
    { encoding: 'utf8' }
  )
  if (result.status !== 0) {
    throw new Error(`n-rules plugin embed-manifest впав: ${result.stderr || result.error?.message}`)
  }
}

/**
 * Скаффолдить у `dir` фейковий crate-корінь із `worlds = []` (свідома
 * порожня декларація — НЕ забудькуватість) і мінімальним `../rules-contract/
 * wit/world.wit`, достатнім для `read_world_publisher_id`
 * (`crates/rules-cli/src/plugin_cmd.rs`) — той самий namespace, що реальний
 * контракт, аби package identity лишався правдоподібним.
 * @param {string} dir tmp-корінь (`crates/` кладеться всередину)
 * @returns {string} абсолютний шлях фейкового crate-dir
 */
function scaffoldEmptyWorldsCrateDir(dir) {
  const witDir = join(dir, 'crates', 'rules-contract', 'wit')
  mkdirSync(witDir, { recursive: true })
  writeFileSync(join(witDir, 'world.wit'), 'package n-rules:plugin@5.0.0;\n', 'utf8')

  const crateDir = join(dir, 'crates', 'fake-guest')
  mkdirSync(crateDir, { recursive: true })
  writeFileSync(join(crateDir, 'Cargo.toml'), '[package]\nname = "fake-guest"\nversion = "0.1.0"\n', 'utf8')
  writeFileSync(join(crateDir, 'plugin.toml'), 'domains = ["lint"]\nworlds = []\n', 'utf8')
  return crateDir
}

describe('declared_worlds — гейт продуктового napi-шляху (крок 6 §12)', () => {
  test('маніфест НЕ вбудований → wasmPluginManifest гучно падає, не мовчазний фолбек', async () => {
    await withTmpDir(async dir => {
      const noManifestPath = join(dir, 'no-manifest.wasm')
      copyFileSync(RAW_WASM_PATH, noManifestPath)

      expect(() => loadNative().wasmPluginManifest(noManifestPath)).toThrow(
        /не несе валідного вбудованого маніфесту/
      )
    })
  })

  test(
    'маніфест декларує worlds=[] для компонента, що РЕАЛЬНО імпортує file-reader ' +
      '→ інстанціація падає (гучно), не мовчазна деградація',
    async () => {
      await withTmpDir(async dir => {
        const fakeCrateDir = scaffoldEmptyWorldsCrateDir(dir)
        const emptyWorldsPath = join(dir, 'empty-worlds.wasm')
        copyFileSync(RAW_WASM_PATH, emptyWorldsPath)
        embedManifest(fakeCrateDir, 'fake-empty-worlds', emptyWorldsPath)

        // `plugin_lang_js.wasm` (крок 5, PR #621) РЕАЛЬНО імпортує
        // `n-rules:caps/file-reader@1.0.0` (T0-фікс `bun/package_json`) —
        // маніфест, що каже `worlds = []`, лишає лінкер без цього імпорту,
        // Component Model відмовляється інстанціюватись: рівно та сама
        // half критерію готовності, що `undeclared_world_fails_instantiation_loudly`
        // доводить на рівні `PluginHost` — тут через napi.
        expect(() => loadNative().wasmPluginManifest(emptyWorldsPath)).toThrow()
      })
    }
  )

  test(
    'маніфест декларує реальні worlds гостя (file-reader + coverage-provider, крок 6 §12) ' +
      '→ інстанціюється й describe() бачить обидва',
    async () => {
      await withTmpDir(async dir => {
        const validPath = join(dir, 'valid.wasm')
        copyFileSync(RAW_WASM_PATH, validPath)
        embedManifest(REAL_CRATE_DIR, 'lang-js', validPath)

        const manifest = loadNative().wasmPluginManifest(validPath)

        // Крок 6 спеки `docs/specs/2026-08-31-plugin-contract-v5.md` §12
        // (§2.123/§2.126 реєстру відкритих питань) додав ДРУГИЙ запис —
        // `plugin-lang-js` тепер оголошує і `n-rules:caps/file-reader@1.0.0`
        // (крок 5), і `n-rules:surfaces/coverage-provider@1.0.0` (крок 6).
        expect(manifest.worlds).toEqual([
          'n-rules:caps/file-reader@1.0.0',
          'n-rules:surfaces/coverage-provider@1.0.0'
        ])
      })
    }
  )
})
