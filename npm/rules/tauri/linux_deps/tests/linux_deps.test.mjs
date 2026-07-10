/**
 * Тести concern-а `tauri/linux_deps` (tauri.mdc):
 *   - без `src-tauri/Cargo.toml` правило не активується (навіть без apt-кроку);
 *   - Tauri-проєкт + lint-rust.yml без apt-кроку → violation missing-linux-deps-step;
 *   - apt-крок є, але бракує канонічного пакета → missing-linux-deps-packages;
 *   - повний канонічний блок → чисто;
 *   - lint-rust.yml відсутній → чисто (існування — rust.lint_rust_yml);
 *   - T0-фікс вставляє блок перед dtolnay/rust-toolchain, ідемпотентно;
 *   - appendMissingPackages дописує пакети в наявний apt-рядок (і з `\`-continuation).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import { MISSING_LINUX_DEPS_PACKAGES, MISSING_LINUX_DEPS_STEP, lint } from '../main.mjs'
import { appendMissingPackages, insertLinuxDepsStep, patterns } from '../fix-linux_deps.mjs'

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
 * Прогоняє T0-патерни над violations (як central fix-pipeline).
 * @param {import('../../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} violations порушення
 * @param {string} dir корінь тимчасового проєкту
 * @returns {Promise<void>}
 */
async function applyT0(violations, dir) {
  const ctx = { cwd: dir, ruleId: 'tauri', concernId: 'linux_deps', recordWrite: vi.fn() }
  for (const p of patterns) {
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

describe('tauri/linux_deps fix', () => {
  test('вставляє apt-крок перед dtolnay/rust-toolchain', () => {
    const next = insertLinuxDepsStep(NO_DEPS_YML)
    const lines = next.split('\n')
    const aptIdx = lines.findIndex(l => l.includes('apt-get install'))
    const toolchainIdx = lines.findIndex(l => l.includes('dtolnay/rust-toolchain'))
    const checkoutIdx = lines.findIndex(l => l.includes('actions/checkout'))
    expect(aptIdx).toBeGreaterThan(checkoutIdx)
    expect(aptIdx).toBeLessThan(toolchainIdx)
    expect(next).toContain('libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev')
  })

  test('без toolchain-кроку не вставляє (нетипове форматування — T1/LLM)', () => {
    expect(insertLinuxDepsStep('jobs:\n  lint:\n    steps:\n      - run: cargo clippy\n')).toBeNull()
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

  test('appendMissingPackages дописує відсутні пакети в наявний apt-рядок', () => {
    const next = appendMissingPackages(PARTIAL_DEPS_YML)
    expect(next).toContain('sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev')
  })

  test('appendMissingPackages зберігає shell-continuation `\\`', () => {
    const yml = `jobs:
  lint:
    steps:
      - run: |
          sudo apt-get install -y libwebkit2gtk-4.1-dev \\
            build-essential
      - uses: dtolnay/rust-toolchain@stable
`
    const next = appendMissingPackages(yml)
    expect(next).toContain('libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \\')
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
})
