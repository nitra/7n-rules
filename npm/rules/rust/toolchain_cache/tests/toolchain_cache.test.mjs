/**
 * Тести concern-а `rust/toolchain_cache` (rust.mdc):
 *   - job з `dtolnay/rust-toolchain@stable` без `Swatinem/rust-cache@v2` → violation;
 *   - job з обома кроками → чисто;
 *   - другий job у тому самому файлі не впливає на перший (job-межа через indentation);
 *   - T0-фікс вставляє cache-крок одразу після toolchain-кроку, ідемпотентно;
 *   - Tauri-job (`tauri-apps/tauri-action`) без root Cargo.toml, але з
 *     `src-tauri/Cargo.toml` → вимагає `with.workspaces: src-tauri` на cache-кроці.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import { MISSING_RUST_CACHE, MISSING_RUST_CACHE_WORKSPACES, lint } from '../main.mjs'
import { addCacheWorkspaces, insertRustCache, patterns } from '../fix-toolchain_cache.mjs'

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
 * Прогоняє T0-патерни над violations (як central fix-pipeline).
 * @param {import('../../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} violations порушення
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

describe('rust/toolchain_cache detector', () => {
  test('job без Swatinem/rust-cache → violation', async () => {
    const root = makeRoot()
    try {
      writeWorkflow(root, 'release.yml', NO_CACHE_YML)
      const { violations } = await lint({ cwd: root, ruleId: 'rust', concernId: 'toolchain_cache' })
      expect(violations.some(v => v.reason === MISSING_RUST_CACHE)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('job з Swatinem/rust-cache одразу після → чисто', async () => {
    const root = makeRoot()
    try {
      writeWorkflow(root, 'lint-rust.yml', WITH_CACHE_YML)
      const { violations } = await lint({ cwd: root, ruleId: 'rust', concernId: 'toolchain_cache' })
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('другий job у файлі не впливає на перший (job-межа)', async () => {
    const root = makeRoot()
    try {
      writeWorkflow(
        root,
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
      const { violations } = await lint({ cwd: root, ruleId: 'rust', concernId: 'toolchain_cache' })
      expect(violations.filter(v => v.reason === MISSING_RUST_CACHE)).toHaveLength(1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('Tauri-job без root Cargo.toml, з src-tauri/Cargo.toml → вимагає workspaces', async () => {
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
      const { violations } = await lint({ cwd: root, ruleId: 'rust', concernId: 'toolchain_cache' })
      expect(violations.some(v => v.reason === MISSING_RUST_CACHE_WORKSPACES)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/**
 * Читає вміст workflow-файла з тимчасового проєкту.
 * @param {string} root корінь проєкту
 * @param {string} name ім'я файла
 * @returns {string} вміст файла
 */
function readWorkflow(root, name) {
  return readFileSync(join(root, '.github', 'workflows', name), 'utf8')
}

describe('rust/toolchain_cache fix', () => {
  test('вставляє Swatinem/rust-cache@v2 одразу після toolchain-кроку (і його with-блоку)', () => {
    const next = insertRustCache(NO_CACHE_YML)
    const lines = next.split('\n')
    const componentsIdx = lines.findIndex(l => l.includes('components: rustfmt, clippy'))
    const cacheIdx = lines.findIndex(l => l.includes('Swatinem/rust-cache@v2'))
    const tauriActionIdx = lines.findIndex(l => l.includes('tauri-apps/tauri-action@v0'))
    expect(cacheIdx).toBeGreaterThan(componentsIdx)
    expect(cacheIdx).toBeLessThan(tauriActionIdx)
  })

  test('ідемпотентно: T0-фікс закриває violation, повторний прогін не змінює файл', async () => {
    const root = makeRoot()
    try {
      writeWorkflow(root, 'release.yml', NO_CACHE_YML)
      const first = await lint({ cwd: root, ruleId: 'rust', concernId: 'toolchain_cache' })
      await applyT0(first.violations, root)
      const second = await lint({ cwd: root, ruleId: 'rust', concernId: 'toolchain_cache' })
      expect(second.violations).toEqual([])

      const contentAfterFirstFix = readWorkflow(root, 'release.yml')
      await applyT0(second.violations, root)
      expect(readWorkflow(root, 'release.yml')).toBe(contentAfterFirstFix)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
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
