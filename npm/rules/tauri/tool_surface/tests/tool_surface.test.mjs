/**
 * Тести concern-а `tauri/tool_surface` (tauri.mdc):
 *   - без Tauri-маркера (`tauri.conf.json`) правило не активується;
 *   - JS торкається плагіна через `@tauri-apps/plugin-*`, але crate відсутній
 *     у Cargo.toml → violation tool-surface-plugin-dep-missing;
 *   - crate є, але не зареєстрований у lib.rs → tool-surface-plugin-not-registered;
 *   - зареєстрований, але немає permission у capabilities/*.json →
 *     tool-surface-plugin-capability-missing;
 *   - прямий `invoke('plugin:slug|cmd')` теж тригерить перевірку;
 *   - повний канонічний ланцюжок (dep + lib.rs + capability) → чисто.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { PLUGIN_CAPABILITY_MISSING, PLUGIN_DEP_MISSING, PLUGIN_NOT_REGISTERED, lint } from '../main.mjs'

/** @returns {string} абсолютний шлях тимчасового кореня проєкту */
function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'tauri-tool-surface-'))
}

/**
 * Створює маркер Tauri-застосунку (`tauri.conf.json`) у корені.
 * @param {string} root корінь проєкту
 */
function makeTauriMarker(root) {
  writeFileSync(join(root, 'tauri.conf.json'), '{}\n')
}

/**
 * Пише JS-файл, що торкається плагіна `dialog` через wrapper-import.
 * @param {string} root корінь проєкту
 */
function writeJsPluginImport(root) {
  const dir = join(root, 'src')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'App.vue'),
    `<script setup>\nimport { open } from '@tauri-apps/plugin-dialog'\nopen()\n</script>\n`
  )
}

/**
 * Пише JS-файл, що торкається плагіна `shell` через прямий invoke.
 * @param {string} root корінь проєкту
 */
function writeJsInvokeCall(root) {
  const dir = join(root, 'src')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'main.ts'),
    `import { invoke } from '@tauri-apps/api/core'\ninvoke('plugin:shell|open', { path: '/tmp' })\n`
  )
}

/**
 * Пише `src-tauri/Cargo.toml` з переліком crate-залежностей.
 * @param {string} root корінь проєкту
 * @param {string[]} deps назви crate під `[dependencies]`
 */
function writeCargoToml(root, deps) {
  const dir = join(root, 'src-tauri')
  mkdirSync(dir, { recursive: true })
  const lines = ['[dependencies]', ...deps.map(d => `${d} = "2"`)]
  writeFileSync(join(dir, 'Cargo.toml'), `${lines.join('\n')}\n`)
}

/**
 * Пише `src-tauri/src/lib.rs` з реєстрацією плагінів.
 * @param {string} root корінь проєкту
 * @param {string[]} identifiers rust-ідентифікатори (`tauri_plugin_dialog`)
 */
function writeLibRs(root, identifiers) {
  const dir = join(root, 'src-tauri', 'src')
  mkdirSync(dir, { recursive: true })
  const plugins = identifiers.map(id => `        .plugin(${id}::init())`).join('\n')
  writeFileSync(
    join(dir, 'lib.rs'),
    `pub fn run() {\n    tauri::Builder::default()\n${plugins}\n        .run(tauri::generate_context!())\n        .unwrap();\n}\n`
  )
}

/**
 * Пише `src-tauri/capabilities/default.json` з переліком permissions.
 * @param {string} root корінь проєкту
 * @param {string[]} permissions permission-ідентифікатори (`dialog:default`)
 */
function writeCapabilities(root, permissions) {
  const dir = join(root, 'src-tauri', 'capabilities')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'default.json'), JSON.stringify({ permissions }, null, 2))
}

describe('tauri/tool_surface detector', () => {
  test('без tauri.conf.json (не Tauri-застосунок) правило не активується', async () => {
    const root = makeRoot()
    try {
      writeJsPluginImport(root)
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'tool_surface' })
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('JS торкається плагіна, якого зовсім немає в Cargo.toml → усі три violations', async () => {
    const root = makeRoot()
    try {
      makeTauriMarker(root)
      writeJsPluginImport(root)
      // немає ні Cargo.toml, ні lib.rs, ні capabilities
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'tool_surface' })
      const reasons = violations.map(v => v.reason)
      expect(reasons).toContain(PLUGIN_DEP_MISSING)
      expect(reasons).toContain(PLUGIN_NOT_REGISTERED)
      expect(reasons).toContain(PLUGIN_CAPABILITY_MISSING)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('crate у Cargo.toml, але не зареєстрований у lib.rs → лише not-registered + capability-missing', async () => {
    const root = makeRoot()
    try {
      makeTauriMarker(root)
      writeJsPluginImport(root)
      writeCargoToml(root, ['tauri-plugin-dialog'])
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'tool_surface' })
      const reasons = violations.map(v => v.reason)
      expect(reasons).not.toContain(PLUGIN_DEP_MISSING)
      expect(reasons).toContain(PLUGIN_NOT_REGISTERED)
      expect(reasons).toContain(PLUGIN_CAPABILITY_MISSING)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('dep + lib.rs є, але немає permission у capabilities/*.json → лише capability-missing', async () => {
    const root = makeRoot()
    try {
      makeTauriMarker(root)
      writeJsPluginImport(root)
      writeCargoToml(root, ['tauri-plugin-dialog'])
      writeLibRs(root, ['tauri_plugin_dialog'])
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'tool_surface' })
      const reasons = violations.map(v => v.reason)
      expect(reasons).toEqual([PLUGIN_CAPABILITY_MISSING])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('прямий invoke("plugin:shell|...") теж тригерить перевірку (не лише wrapper-import)', async () => {
    const root = makeRoot()
    try {
      makeTauriMarker(root)
      writeJsInvokeCall(root)
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'tool_surface' })
      expect(violations.some(v => v.data?.slug === 'shell')).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('повний канонічний ланцюжок (dep + lib.rs + capability) → чисто', async () => {
    const root = makeRoot()
    try {
      makeTauriMarker(root)
      writeJsPluginImport(root)
      writeCargoToml(root, ['tauri-plugin-dialog'])
      writeLibRs(root, ['tauri_plugin_dialog'])
      writeCapabilities(root, ['dialog:default'])
      const { violations } = await lint({ cwd: root, ruleId: 'tauri', concernId: 'tool_surface' })
      expect(violations).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
