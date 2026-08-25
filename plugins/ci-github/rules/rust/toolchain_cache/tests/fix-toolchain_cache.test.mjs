/**
 * Тести T0-фіксера `rust/toolchain_cache` (`fix-toolchain_cache.mjs` —
 * лишається JS-каноном: `Guest::fix` гостя `crates/plugin-ci-github` для
 * цього концерну свідомо віддає порожній план, T0-логіка й далі живе тут).
 *
 * Виділені з `toolchain_cache.test.mjs` при знятті JS-детектора (`main.mjs`):
 * той файл будував вхід фіксера викликом `lint()` детектора. Детекторна
 * половина файлу (`describe('rust/toolchain_cache detector', …)`, 4 тести)
 * НЕ перенесена — вона перевіряла `main.mjs`, якого більше немає; той самий
 * контур тепер покриває `wasm-plugin-parity-ci-github.test.mjs`
 * (24 сценарії) і юніт-тести гостя (`crates/plugin-ci-github`).
 *
 * `describe('T0 round-trip …')` нижче — АНТИ-ДРЕЙФ-ГАРАНТІЯ, не просто
 * unit-тест: `data.kind`-рядки (`missing-rust-cache`/`missing-rust-cache-workspaces`)
 * живуть по ОБИДВА боки межі гість↔фіксер (гість їх генерує в Rust,
 * `MISSING_RUST_CACHE`/`MISSING_RUST_CACHE_WORKSPACES` у `fix-toolchain_cache.mjs`
 * їх зіставляють) — і ПІСЛЯ зняття `main.mjs` жодна спільна крапка коду їх
 * більше не тримає РАЗОМ. Обидва тести ганяють РЕАЛЬНИЙ
 * `loadNative().runWasmConcern(…, 'rust/toolchain_cache', …)` на справжньому
 * workflow-файлі й згодовують отримані `violations` фіксеру напряму — не
 * вигадані літерали, а фактичний вивід гостя. Перевірено дією (не
 * припущенням): тимчасова зміна значення `MISSING_RUST_CACHE` в
 * `fix-toolchain_cache.mjs` на невірний рядок валила обидва тести нижче
 * (`patterns[0].test` більше не матчив `data.kind` гостя) — повернуто,
 * перевірено, що знову зелено.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import { loadNative } from '@7n/rules/scripts/lib/native.mjs'
import { realRepoRoot } from '@7n/rules/scripts/utils/test-helpers.mjs'

import { addCacheWorkspaces, insertRustCache, patterns } from '../fix-toolchain_cache.mjs'

const WASM_PATH = join(realRepoRoot(), 'target', 'wasm32-wasip2', 'release', 'plugin_ci_github.wasm')

if (!existsSync(WASM_PATH)) {
  throw new Error(
    `fix-toolchain_cache.test.mjs: wasm-компонент plugin-ci-github не зібраний: ${WASM_PATH} відсутній.\n` +
      'Зберіть його командою: bash crates/plugin-ci-github/build.sh'
  )
}

/** @returns {string} абсолютний шлях тимчасового кореня проєкту */
function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'rust-toolchain-cache-'))
}

/**
 * Пише workflow-файл у `<root>/.github/workflows/<name>`.
 * @param {string} root корінь проєкту
 * @param {string} name ім'я файла
 * @param {string} content вміст
 */
function writeWorkflow(root, name, content) {
  const dir = join(root, '.github', 'workflows')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), content)
}

/**
 * Читає вміст workflow-файла з тимчасового проєкту.
 * @param {string} root корінь проєкту
 * @param {string} name ім'я файла
 * @returns {string} вміст файла
 */
function readWorkflow(root, name) {
  return readFileSync(join(root, '.github', 'workflows', name), 'utf8')
}

/**
 * Прогоняє T0-патерни над violations (як central fix-pipeline).
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintViolation[]} violations порушення
 * @param {string} dir корінь тимчасового проєкту
 * @returns {Promise<void>}
 */
async function applyT0(violations, dir) {
  const ctx = { cwd: dir, ruleId: 'rust', concernId: 'toolchain_cache', recordWrite: vi.fn() }
  for (const p of patterns) {
    if (p.test(violations)) await p.apply(violations, ctx)
  }
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

describe('fix rust.toolchain_cache — T0 текстові трансформери', () => {
  test('insertRustCache: вставляє Swatinem/rust-cache@v2 одразу після toolchain-кроку (і його with-блоку)', () => {
    const next = insertRustCache(NO_CACHE_YML)
    const lines = next.split('\n')
    const componentsIdx = lines.findIndex(l => l.includes('components: rustfmt, clippy'))
    const cacheIdx = lines.findIndex(l => l.includes('Swatinem/rust-cache@v2'))
    const tauriActionIdx = lines.findIndex(l => l.includes('tauri-apps/tauri-action@v0'))
    expect(cacheIdx).toBeGreaterThan(componentsIdx)
    expect(cacheIdx).toBeLessThan(tauriActionIdx)
  })

  test('addCacheWorkspaces дописує with.workspaces у наявний cache-крок', () => {
    const next = addCacheWorkspaces(
      `jobs:
  build:
    steps:
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - uses: tauri-apps/tauri-action@v0
`,
      'src-tauri'
    )
    expect(next).toContain('workspaces: src-tauri')
  })
})

describe('T0 round-trip — runWasmConcern(plugin-ci-github) → fix-toolchain_cache (анти-дрейф reason-кодів)', () => {
  test('missing-rust-cache: гість детектує, фіксер розпізнає, вставляє cache-крок; повторний прогін — чисто й незмінно', async () => {
    const root = makeRoot()
    try {
      writeWorkflow(root, 'release.yml', NO_CACHE_YML)

      const first = loadNative().runWasmConcern(WASM_PATH, 'rust/toolchain_cache', root, null)
      expect(first.violations.some(v => v.data?.kind === 'missing-rust-cache')).toBe(true)

      await applyT0(first.violations, root)
      expect(readWorkflow(root, 'release.yml')).toContain('Swatinem/rust-cache@v2')

      // Анти-дрейф: ПІСЛЯ фіксу гість (реальний детектор, не фіксер) мовчить —
      // доводить, що фіксер справді закрив те саме порушення, яке гість видав.
      const second = loadNative().runWasmConcern(WASM_PATH, 'rust/toolchain_cache', root, null)
      expect(second.violations).toEqual([])

      // Ідемпотентність: повторний прогін T0 на вже чистому файлі нічого не змінює.
      const contentAfterFirstFix = readWorkflow(root, 'release.yml')
      await applyT0(second.violations, root)
      expect(readWorkflow(root, 'release.yml')).toBe(contentAfterFirstFix)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('missing-rust-cache-workspaces: гість детектує, фіксер розпізнає, дописує with.workspaces; повторний прогін — чисто й незмінно', async () => {
    const root = makeRoot()
    try {
      mkdirSync(join(root, 'src-tauri'), { recursive: true })
      writeFileSync(join(root, 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\n')
      writeWorkflow(
        root,
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

      const first = loadNative().runWasmConcern(WASM_PATH, 'rust/toolchain_cache', root, null)
      expect(first.violations.some(v => v.data?.kind === 'missing-rust-cache-workspaces')).toBe(true)

      await applyT0(first.violations, root)
      expect(readWorkflow(root, 'release.yml')).toContain('workspaces: src-tauri')

      const second = loadNative().runWasmConcern(WASM_PATH, 'rust/toolchain_cache', root, null)
      expect(second.violations).toEqual([])

      const contentAfterFirstFix = readWorkflow(root, 'release.yml')
      await applyT0(second.violations, root)
      expect(readWorkflow(root, 'release.yml')).toBe(contentAfterFirstFix)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
