/**
 * Тести концерну `rust/wasm_component` (wasm_component.mdc): Component Model —
 * обов'язковий режим wasm; `wasm-bindgen` і `wasmtime` без `component-model`
 * заборонені.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { WASM_BINDGEN_FORBIDDEN, WASMTIME_MISSING_COMPONENT_MODEL, lint } from '../main.mjs'

/** @returns {string} абсолютний шлях тимчасового кореня */
function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'rust-wasm-component-'))
}

/**
 * Пише Cargo.toml у `root/relDir` (порожній `relDir` — кореневий файл).
 * @param {string} root корінь тимчасового репозиторію
 * @param {string} relDir відносний каталог (`''` — корінь)
 * @param {string} content вміст Cargo.toml
 * @returns {string} posix-relative шлях написаного файлу
 */
function writeManifest(root, relDir, content) {
  const dir = relDir ? join(root, relDir) : root
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'Cargo.toml'), content)
  return relDir ? `${relDir}/Cargo.toml` : 'Cargo.toml'
}

/**
 * @param {string} dir корінь репозиторію
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintViolation[]>} violations
 */
async function run(dir) {
  const { violations } = await lint({ cwd: dir, ruleId: 'rust', concernId: 'wasm_component', files: undefined })
  return violations
}

describe('rust/wasm_component', () => {
  test('без wasm-bindgen/wasmtime — чисто', async () => {
    const root = makeRoot()
    try {
      writeManifest(root, '', '[package]\nname = "a"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1"\n')
      expect(await run(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('пряма залежність wasm-bindgen — порушення', async () => {
    const root = makeRoot()
    try {
      writeManifest(root, '', '[package]\nname = "a"\nversion = "0.1.0"\n\n[dependencies]\nwasm-bindgen = "0.2"\n')
      const violations = await run(root)
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe(WASM_BINDGEN_FORBIDDEN)
      expect(violations[0].file).toBe('Cargo.toml')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("wasm-bindgen у [target.'cfg(...)'.dependencies] — порушення", async () => {
    const root = makeRoot()
    try {
      writeManifest(
        root,
        '',
        '[package]\nname = "a"\nversion = "0.1.0"\n\n' +
          '[target.\'cfg(target_arch = "wasm32")\'.dependencies]\nwasm-bindgen = "0.2"\n'
      )
      const violations = await run(root)
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe(WASM_BINDGEN_FORBIDDEN)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('wasm-bindgen успадкований через workspace = true — порушення', async () => {
    const root = makeRoot()
    try {
      writeManifest(
        root,
        '',
        '[workspace]\nresolver = "2"\nmembers = ["crates/a"]\n\n[workspace.dependencies]\nwasm-bindgen = "0.2"\n'
      )
      writeManifest(
        root,
        'crates/a',
        '[package]\nname = "a"\nversion = "0.1.0"\n\n[dependencies]\nwasm-bindgen = { workspace = true }\n'
      )
      const violations = await run(root)
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe(WASM_BINDGEN_FORBIDDEN)
      expect(violations[0].file).toBe('crates/a/Cargo.toml')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('workspace = true без запису в [workspace.dependencies] — тихо (не резолвиться)', async () => {
    const root = makeRoot()
    try {
      writeManifest(root, '', '[workspace]\nresolver = "2"\nmembers = ["crates/a"]\n')
      writeManifest(
        root,
        'crates/a',
        '[package]\nname = "a"\nversion = "0.1.0"\n\n[dependencies]\nwasm-bindgen = { workspace = true }\n'
      )
      expect(await run(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('wasmtime без default-features (дефолти увімкнені) — чисто (component-model дефолтна)', async () => {
    const root = makeRoot()
    try {
      writeManifest(root, '', '[package]\nname = "a"\nversion = "0.1.0"\n\n[dependencies]\nwasmtime = "47.0"\n')
      expect(await run(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('wasmtime default-features = false + component-model у features — чисто', async () => {
    const root = makeRoot()
    try {
      writeManifest(
        root,
        '',
        '[package]\nname = "a"\nversion = "0.1.0"\n\n[dependencies]\n' +
          'wasmtime = { version = "47.0", default-features = false, features = ["component-model", "runtime"] }\n'
      )
      expect(await run(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('wasmtime default-features = false без component-model — порушення', async () => {
    const root = makeRoot()
    try {
      writeManifest(
        root,
        '',
        '[package]\nname = "a"\nversion = "0.1.0"\n\n[dependencies]\n' +
          'wasmtime = { version = "47.0", default-features = false, features = ["runtime"] }\n'
      )
      const violations = await run(root)
      expect(violations).toHaveLength(1)
      expect(violations[0].reason).toBe(WASMTIME_MISSING_COMPONENT_MODEL)
      expect(violations[0].file).toBe('Cargo.toml')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('wasmtime успадкований через workspace = true, з component-model — чисто', async () => {
    const root = makeRoot()
    try {
      writeManifest(
        root,
        '',
        '[workspace]\nresolver = "2"\nmembers = ["crates/a"]\n\n' +
          '[workspace.dependencies]\n' +
          'wasmtime = { version = "47.0", default-features = false, features = ["component-model"] }\n'
      )
      writeManifest(
        root,
        'crates/a',
        '[package]\nname = "a"\nversion = "0.1.0"\n\n[dependencies]\nwasmtime = { workspace = true }\n'
      )
      expect(await run(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('files (per-file) — фільтрує до Cargo.toml і ловить порушення лише в них', async () => {
    const root = makeRoot()
    try {
      writeManifest(root, '', '[package]\nname = "a"\nversion = "0.1.0"\n\n[dependencies]\nwasm-bindgen = "0.2"\n')
      const { violations } = await lint({
        cwd: root,
        ruleId: 'rust',
        concernId: 'wasm_component',
        files: ['src/lib.rs']
      })
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
