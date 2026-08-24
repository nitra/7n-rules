/**
 * Parity-тест wasm-плагіна `plugin-ci-github` — П'ЯТОГО first-party
 * wasm-гостя (перший — `plugin-lang-js`, `wasm-plugin-parity.test.mjs`,
 * другий — `plugin-lang-python`, третій — `plugin-lang-rust`, четвертий —
 * `plugin-lang-php`, `wasm-plugin-parity-php.test.mjs`): ганяє ОДНІ фікстури
 * через ЖИВИЙ JS-детектор (`plugins/ci-github/rules/rust/toolchain_cache/
 * main.mjs` — Plugin API v2, канон НЕ видаляється цією задачею) і через
 * `runWasmConcern` napi-мосту (`crates/rules-napi` → `crates/plugin-ci-github`),
 * звіряючи, що `violations` ідентичні (reason/message/file/severity/data
 * біт-у-біт) — той самий non-golden режим, що `wasm-plugin-parity-php.test.mjs`
 * (JS-канон `ci-github` лишається живим, `ga/workflows`/`ci_artifact/consume`
 * СВІДОМО поза обсягом цієї хвилі — доккомент `crates/plugin-ci-github/src/lib.rs`).
 *
 * `rust/toolchain_cache` — full-scope, БЕЗ жодного `exec-tool` (на відміну
 * від `php/project`/`php/composer_manifest` — жодного фейкового бінарника
 * тут не потрібно): JS-канон читає диск напряму (`readdir`/`existsSync`),
 * тож `lint({ cwd: dir, ruleId: 'rust', concernId: 'toolchain_cache' })`
 * викликається БЕЗ `files` — той самий контракт, що `php/tooling`
 * (`runFullScopeBoth`, `wasm-plugin-parity-php.test.mjs`), лише простіший
 * (нема відомої «process.cwd() замість ctx.cwd»-вади, яку той канон мав:
 * `main.mjs` тут скрізь коректно `join(cwd, …)`, звірено читанням джерела).
 *
 * Порядок workflow-файлів у batch між JS `readdir` і host `walk_dir` НЕ
 * гарантовано збігається (доккомент `crates/plugin-ci-github/src/lib.rs`,
 * розділ «Порядок workflow-файлів»)  — кожен сценарій тут пише РІВНО ОДИН
 * workflow-файл, той самий обсяг, що власний JS-тест канону
 * (`toolchain_cache.test.mjs`), де «другий job не впливає на перший» теж
 * перевіряється в межах ОДНОГО файла, не через два файли.
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, test } from 'vitest'

import { loadNative } from '../../native.mjs'
import { realRepoRoot, withTmpDir } from '../../../utils/test-helpers.mjs'

const REPO_ROOT = realRepoRoot()
const WASM_PATH = join(REPO_ROOT, 'target', 'wasm32-wasip2', 'release', 'plugin_ci_github.wasm')

if (!existsSync(WASM_PATH)) {
  throw new Error(
    `wasm-plugin-parity-ci-github.test.mjs: wasm-компонент plugin-ci-github не зібраний: ${WASM_PATH} відсутній.\n` +
      'Зберіть його командою: bash crates/plugin-ci-github/build.sh'
  )
}

const MAIN_MJS_PATH = join(REPO_ROOT, 'plugins', 'ci-github', 'rules', 'rust', 'toolchain_cache', 'main.mjs')
const CONCERN_KEY = 'rust/toolchain_cache'

/** Size-budget компонента — той самий бюджет, що решта чотирьох гостей (доккомент модуля). */
const WASM_SIZE_BUDGET_BYTES = 2.5 * 1024 * 1024

/**
 * Виставляє дефолт `severity: 'error'`, якщо ключ відсутній — той самий
 * normalize-крок, що в решти чотирьох parity-файлів: raw JS `lint()` опускає
 * дефолтне поле, WIT `record diagnostic.severity` не опційне.
 * @param {unknown[]} violations сирі violations (JS чи wasm)
 * @returns {unknown[]} ті самі violations із заповненим `severity`
 */
function withDefaultSeverity(violations) {
  return violations.map(v => ({ severity: 'error', ...v }))
}

/**
 * Пише workflow-файл у `<dir>/.github/workflows/<name>`.
 * @param {string} dir абсолютний шлях tmp-каталогу
 * @param {string} name ім'я файла
 * @param {string} content вміст
 * @returns {Promise<void>}
 */
async function writeWorkflow(dir, name, content) {
  const wfDir = join(dir, '.github', 'workflows')
  await mkdir(wfDir, { recursive: true })
  await writeFile(join(wfDir, name), content, 'utf8')
}

/**
 * Ганяє `rust/toolchain_cache` (full-scope, БЕЗ `exec-tool`) через JS-канон
 * і `runWasmConcern` з `files: null` (host сам будує batch за
 * `ConcernContribution::glob` — `.github/workflows/*.{yml,yaml}` +
 * `Cargo.toml`/`src-tauri/Cargo.toml`, доккомент `plugin.toml`).
 * @param {string} dir абсолютний шлях tmp-каталогу з уже записаними фікстурами
 * @returns {Promise<{ js: unknown[], wasm: unknown[] }>} результати обох реалізацій
 */
async function runToolchainCacheBoth(dir) {
  // eslint-disable-next-line no-unsanitized/method
  const { lint } = await import(pathToFileURL(MAIN_MJS_PATH).href)
  const jsResult = await lint({ cwd: dir, ruleId: 'rust', concernId: 'toolchain_cache' })
  const wasmResult = loadNative().runWasmConcern(WASM_PATH, CONCERN_KEY, dir, null)
  return { js: withDefaultSeverity(jsResult.violations), wasm: withDefaultSeverity(wasmResult.violations) }
}

const NO_CACHE_YML = `name: Release
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: tauri-apps/tauri-action@v0
`

const WITH_CACHE_YML = `name: Lint
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --all -- --check
`

describe('wasm-plugin parity — rust/toolchain_cache (JS канон vs wasm plugin-ci-github, без exec-tool)', () => {
  test('.github/workflows відсутній — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('job з dtolnay/rust-toolchain без Swatinem/rust-cache — однакове missing-rust-cache', async () => {
    await withTmpDir(async dir => {
      await writeWorkflow(dir, 'release.yml', NO_CACHE_YML)
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-rust-cache')
      expect(js[0].file).toBe('.github/workflows/release.yml')
      expect(js[0].data).toEqual({ kind: 'missing-rust-cache' })
    })
  })

  test('job з Swatinem/rust-cache одразу після — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeWorkflow(dir, 'lint-rust.yml', WITH_CACHE_YML)
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('.yaml розширення теж опрацьовується — однакове missing-rust-cache', async () => {
    await withTmpDir(async dir => {
      await writeWorkflow(dir, 'release.yaml', NO_CACHE_YML)
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-rust-cache')
    })
  })

  test('другий job у тому самому файлі не впливає на перший (job-межа через indentation)', async () => {
    await withTmpDir(async dir => {
      await writeWorkflow(
        dir,
        'ci.yml',
        `name: CI
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: dtolnay/rust-toolchain@stable
      - uses: tauri-apps/tauri-action@v0
`
      )
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js.filter(v => v.reason === 'missing-rust-cache')).toHaveLength(1)
    })
  })

  test('toolchain-крок — останній рядок файла (кінець jobs:, без trailing newline) — однакове missing-rust-cache', async () => {
    await withTmpDir(async dir => {
      const wfDir = join(dir, '.github', 'workflows')
      await mkdir(wfDir, { recursive: true })
      await writeFile(
        join(wfDir, 'release.yml'),
        'jobs:\n  build:\n    steps:\n      - uses: dtolnay/rust-toolchain@stable',
        'utf8'
      )
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-rust-cache')
    })
  })

  test('порожній рядок між toolchain- і cache-кроком не ламає скан — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await writeWorkflow(
        dir,
        'ci.yml',
        `jobs:
  build:
    steps:
      - uses: dtolnay/rust-toolchain@stable

      - uses: Swatinem/rust-cache@v2
`
      )
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('Tauri-job без root Cargo.toml, з src-tauri/Cargo.toml — однакове missing-rust-cache-workspaces', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src-tauri'), { recursive: true })
      await writeFile(join(dir, 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\n', 'utf8')
      await writeWorkflow(
        dir,
        'release.yml',
        `name: Release
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - uses: tauri-apps/tauri-action@v0
`
      )
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toHaveLength(1)
      expect(js[0].reason).toBe('missing-rust-cache-workspaces')
      expect(js[0].data).toEqual({ kind: 'missing-rust-cache-workspaces', workspaceDir: 'src-tauri' })
    })
  })

  test('Tauri-job, cache-крок уже має with.workspaces — обидві реалізації мовчать', async () => {
    await withTmpDir(async dir => {
      await mkdir(join(dir, 'src-tauri'), { recursive: true })
      await writeFile(join(dir, 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\n', 'utf8')
      await writeWorkflow(
        dir,
        'release.yml',
        `jobs:
  build:
    steps:
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - uses: tauri-apps/tauri-action@v0
`
      )
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })

  test('Tauri-job, root Cargo.toml присутній (не Tauri-layout) — workspaces-перевірка пропускається', async () => {
    await withTmpDir(async dir => {
      await writeFile(join(dir, 'Cargo.toml'), '[workspace]\n', 'utf8')
      await writeWorkflow(
        dir,
        'release.yml',
        `jobs:
  build:
    steps:
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - uses: tauri-apps/tauri-action@v0
`
      )
      const { js, wasm } = await runToolchainCacheBoth(dir)
      expect(wasm).toEqual(js)
      expect(js).toEqual([])
    })
  })
})

describe('wasm-плагін plugin-ci-github — describe()/розмір', () => {
  test('describe() повертає manifest з рівно одним full-scope концерном', () => {
    const manifest = loadNative().wasmPluginManifest(WASM_PATH)
    expect(manifest.id).toBe('ci-github/wasm-concerns')
    expect(manifest.concerns).toHaveLength(1)
    expect(manifest.concerns[0].key).toBe(CONCERN_KEY)
    expect(manifest.concerns[0].scope).toBe('full')
    expect(manifest.tools).toEqual([])
  })

  test(`зібраний .wasm вкладається в size-budget (${WASM_SIZE_BUDGET_BYTES} байт)`, async () => {
    const { stat } = await import('node:fs/promises')
    const { size } = await stat(WASM_PATH)
    expect(size).toBeLessThan(WASM_SIZE_BUDGET_BYTES)
  })
})
