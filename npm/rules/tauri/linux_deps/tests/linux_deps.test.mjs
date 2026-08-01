/**
 * Тести concern-а `tauri/linux_deps` (tauri.mdc):
 *   - без `src-tauri/Cargo.toml` правило не активується (навіть без apt-кроку);
 *   - Tauri-проєкт + lint-rust.yml без apt-кроку → violation missing-linux-deps-step;
 *   - apt-крок є, але бракує канонічного пакета → missing-linux-deps-packages;
 *   - повний канонічний блок → чисто;
 *   - lint-rust.yml відсутній → чисто (існування — rust.lint_rust_yml);
 *   - T0-фікс вставляє блок перед dtolnay/rust-toolchain, ідемпотентно;
 *   - appendMissingPackages дописує пакети в наявний apt-рядок (і з `\`-continuation).
 *
 * Детектор — через `runConcernDetector` (dispatch-рівень), не пряма функція:
 * JS `main.mjs` видалений (G2 фази 5 батчу 3, TOML-кластер), concern тепер
 * живе лише в `crates/rules-core/src/concerns/tauri_linux_deps.rs` і
 * виконується через native-гілку `runConcernDetector`.
 *
 * T0-фікс (T2 зрізу 5 фази 7): JS `fix-linux_deps.mjs` теж видалений —
 * splice-логіка `insertLinuxDepsStep`/`appendMissingPackages` тепер у
 * `crates/rules-core/src/concerns/fix.rs` (`run_concern_fix`), а JS-бік
 * отримує синтетичний T0Pattern через `loadT0Patterns` (`run-fix.mjs`,
 * реєстр `NATIVE_FIXES`). Тести нижче дзеркалять старі кейси через ЦЮ
 * обгортку; pure-функції splice-ів покриті в native-юніт-тестах (`fix.rs`).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test, vi } from 'vitest'

import { runConcernDetector } from '../../../../scripts/lib/lint-surface/detect.mjs'
import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'
import { createSnapshot } from '../../../../scripts/lib/lint-surface/snapshot.mjs'

/** Стабільний reason: у CI-workflow немає apt-кроку встановлення Linux-залежностей Tauri. */
const MISSING_LINUX_DEPS_STEP = 'missing-linux-deps-step'
/** Стабільний reason: apt-крок є, але в ньому бракує канонічних пакетів. */
const MISSING_LINUX_DEPS_PACKAGES = 'missing-linux-deps-packages'

/** Абсолютний шлях теки концерну (тека з `concern.json`, без main.mjs — native-порт). */
const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONCERN = { dir: CONCERN_DIR }

/**
 * @param {import('../../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінт-прогону
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат детектора
 */
const lint = ctx => runConcernDetector(CONCERN, ctx)

/** @returns {string} абсолютний шлях тимчасового кореня проєкту */
function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'tauri-linux-deps-'))
}

/**
 * Створює маркер Tauri: `<root>/src-tauri/Cargo.toml`.
 * @param {string} root корінь проєкту
 */
function makeSrcTauri(root) {
  mkdirSync(join(root, 'src-tauri'), { recursive: true })
  writeFileSync(join(root, 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\n')
}

/**
 * Пише `<root>/.github/workflows/lint-rust.yml`.
 * @param {string} root корінь проєкту
 * @param {string} content вміст
 */
function writeLintRust(root, content) {
  const dir = join(root, '.github', 'workflows')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'lint-rust.yml'), content)
}

/**
 * Резолвить синтетичний native T0Pattern для `dir` (той самий, що бере реальний fix-pipeline).
 * @param {string} dir корінь тимчасового проєкту
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]>} T0-патерни concern-а
 */
const patternsFor = dir => loadT0Patterns(CONCERN_DIR, 'linux_deps', 'tauri', dir)

/**
 * Прогоняє T0-патерни над violations (як central fix-pipeline).
 * @param {import('../../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} violations порушення
 * @param {string} dir корінь тимчасового проєкту
 * @returns {Promise<void>}
 */
async function applyT0(violations, dir) {
  const ctx = { cwd: dir, ruleId: 'tauri', concernId: 'linux_deps', recordWrite: vi.fn() }
  for (const p of await patternsFor(dir)) {
    if (p.test(violations)) await p.apply(violations, ctx)
  }
}

const NO_DEPS_YML = `name: Lint Rust
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@v2
      - run: cargo fmt --all -- --check
      - run: cargo clippy --all-targets --all-features -- -D warnings
`

const FULL_DEPS_YML = `name: Lint Rust
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: Системні залежності Tauri (Linux)
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo clippy --all-targets --all-features -- -D warnings
`

const PARTIAL_DEPS_YML = `name: Lint Rust
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev
      - uses: dtolnay/rust-toolchain@stable
`

describe('tauri/linux_deps detector', () => {
  test('без src-tauri/Cargo.toml правило не активується', async () => {
    const root = makeRoot()
    try {
      writeLintRust(root, NO_DEPS_YML)
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'linux_deps' })
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('Tauri-проєкт без apt-кроку → missing-linux-deps-step', async () => {
    const root = makeRoot()
    try {
      makeSrcTauri(root)
      writeLintRust(root, NO_DEPS_YML)
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'linux_deps' })
      expect(violations.some(v => v.reason === MISSING_LINUX_DEPS_STEP)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('apt-крок без канонічних пакетів → missing-linux-deps-packages з переліком', async () => {
    const root = makeRoot()
    try {
      makeSrcTauri(root)
      writeLintRust(root, PARTIAL_DEPS_YML)
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'linux_deps' })
      const v = violations.find(x => x.reason === MISSING_LINUX_DEPS_PACKAGES)
      expect(v?.data?.missing).toEqual(['libayatana-appindicator3-dev', 'librsvg2-dev'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('повний канонічний блок → чисто', async () => {
    const root = makeRoot()
    try {
      makeSrcTauri(root)
      writeLintRust(root, FULL_DEPS_YML)
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'linux_deps' })
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('lint-rust.yml відсутній → чисто (існування — rust.lint_rust_yml)', async () => {
    const root = makeRoot()
    try {
      makeSrcTauri(root)
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'linux_deps' })
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/**
 * Читає lint-rust.yml з тимчасового проєкту.
 * @param {string} root корінь проєкту
 * @returns {string} вміст файла
 */
function readLintRust(root) {
  return readFileSync(join(root, '.github', 'workflows', 'lint-rust.yml'), 'utf8')
}

describe('tauri/linux_deps fix (native-fix обгортка)', () => {
  test('loadT0Patterns повертає синтетичний native-fix pattern', async () => {
    const root = makeRoot()
    try {
      const patterns = await patternsFor(root)
      expect(patterns).toHaveLength(1)
      expect(patterns[0].id).toBe('native-fix:tauri/linux_deps')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('вставляє apt-крок перед dtolnay/rust-toolchain', async () => {
    const root = makeRoot()
    try {
      makeSrcTauri(root)
      writeLintRust(root, NO_DEPS_YML)
      const first = await lint({ cwd: root, ruleId: 'tauri', concernId: 'linux_deps' })
      await applyT0(first.violations, root)
      const next = readLintRust(root)
      const lines = next.split('\n')
      const aptIdx = lines.findIndex(l => l.includes('apt-get install'))
      const toolchainIdx = lines.findIndex(l => l.includes('dtolnay/rust-toolchain'))
      const checkoutIdx = lines.findIndex(l => l.includes('actions/checkout'))
      expect(aptIdx).toBeGreaterThan(checkoutIdx)
      expect(aptIdx).toBeLessThan(toolchainIdx)
      expect(next).toContain('libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('без toolchain-кроку не вставляє (нетипове форматування — T1/LLM): план порожній', async () => {
    const root = makeRoot()
    try {
      makeSrcTauri(root)
      const atypical = 'jobs:\n  lint:\n    steps:\n      - run: cargo clippy\n'
      writeLintRust(root, atypical)
      const first = await lint({ cwd: root, ruleId: 'tauri', concernId: 'linux_deps' })
      expect(first.violations.some(v => v.reason === MISSING_LINUX_DEPS_STEP)).toBe(true)
      const [pattern] = await patternsFor(root)
      expect(pattern.test(first.violations)).toBe(false)
      await applyT0(first.violations, root)
      expect(readLintRust(root)).toBe(atypical)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('ідемпотентно: T0-фікс закриває violation, повторний прогін не змінює файл', async () => {
    const root = makeRoot()
    try {
      makeSrcTauri(root)
      writeLintRust(root, NO_DEPS_YML)
      const first = await lint({ cwd: root, ruleId: 'tauri', concernId: 'linux_deps' })
      await applyT0(first.violations, root)
      const second = await lint({ cwd: root, ruleId: 'tauri', concernId: 'linux_deps' })
      expect(second.violations).toEqual([])

      const contentAfterFirstFix = readLintRust(root)
      await applyT0(second.violations, root)
      expect(readLintRust(root)).toBe(contentAfterFirstFix)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('дописує відсутні пакети в наявний apt-рядок', async () => {
    const root = makeRoot()
    try {
      makeSrcTauri(root)
      writeLintRust(root, PARTIAL_DEPS_YML)
      const first = await lint({ cwd: root, ruleId: 'tauri', concernId: 'linux_deps' })
      await applyT0(first.violations, root)
      expect(readLintRust(root)).toContain(
        'sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev'
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('append зберігає shell-continuation `\\`', async () => {
    const root = makeRoot()
    try {
      makeSrcTauri(root)
      const yml = `jobs:
  lint:
    steps:
      - run: |
          sudo apt-get install -y libwebkit2gtk-4.1-dev \\
            build-essential
      - uses: dtolnay/rust-toolchain@stable
`
      writeLintRust(root, yml)
      const first = await lint({ cwd: root, ruleId: 'tauri', concernId: 'linux_deps' })
      await applyT0(first.violations, root)
      const next = readLintRust(root)
      expect(next).toContain('libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \\')
      expect(next).toContain('            build-essential')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('T0-фікс закриває missing-linux-deps-packages ідемпотентно', async () => {
    const root = makeRoot()
    try {
      makeSrcTauri(root)
      writeLintRust(root, PARTIAL_DEPS_YML)
      const first = await lint({ cwd: root, ruleId: 'tauri', concernId: 'linux_deps' })
      await applyT0(first.violations, root)
      const second = await lint({ cwd: root, ruleId: 'tauri', concernId: 'linux_deps' })
      expect(second.violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('rollback-контракт: ctx.recordWrite викликається ДО запису — rollback відновлює старий вміст', async () => {
    const root = makeRoot()
    try {
      makeSrcTauri(root)
      writeLintRust(root, NO_DEPS_YML)
      const first = await lint({ cwd: root, ruleId: 'tauri', concernId: 'linux_deps' })

      const snapshot = createSnapshot()
      let contentAtRecordWriteTime = null
      const ctx = {
        cwd: root,
        ruleId: 'tauri',
        concernId: 'linux_deps',
        recordWrite: absPath => {
          // recordWrite ДО write: pre-image ще ОРИГІНАЛЬНА — інакше rollback
          // відновлював би вже новий вміст.
          contentAtRecordWriteTime = readFileSync(absPath, 'utf8')
          snapshot.record(absPath)
        }
      }
      const [pattern] = await patternsFor(root)
      await pattern.apply(first.violations, ctx)
      expect(contentAtRecordWriteTime).toBe(NO_DEPS_YML)
      expect(readLintRust(root)).toContain('apt-get install')

      snapshot.rollback()
      expect(readLintRust(root)).toBe(NO_DEPS_YML)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
