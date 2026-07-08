/**
 * Тести Tauri-концерну `updater` (tauri.mdc updater):
 *   - silent skip коли в монорепо не знайдено жодного tauri.conf.json;
 *   - канонічний layout (deps, Cargo.toml desktop-scope, lib.rs cfg-guard,
 *     capabilities, useUpdater() у Vue) — чистий детектор;
 *   - кожна складова звітує окремою стабільною причиною при відхиленні.
 */
import { describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { lint } from '../main.mjs'

const PACKAGE_JSON = {
  name: 'app',
  version: '0.0.0',
  dependencies: {
    '@7n/tauri-components': '^0.8.0',
    '@tauri-apps/plugin-updater': '^2',
    '@tauri-apps/plugin-process': '^2'
  }
}

const CARGO_TOML = `[package]
name = "app"
version = "0.1.0"

[dependencies]
tauri-plugin-process = "2.3.1"

[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
tauri-plugin-updater = "2"
`

const LIB_RS = `pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    let builder = builder.plugin(tauri_plugin_process::init());

    builder.run(tauri::generate_context!()).unwrap();
}
`

const APP_VUE = `<script setup>
import { useUpdater } from '@7n/tauri-components/vue'

useUpdater()
</script>
`

const DEFAULT_CAPABILITY = JSON.stringify({
  identifier: 'default',
  windows: ['main'],
  permissions: ['core:default', 'process:allow-restart']
})

const UPDATER_CAPABILITY = JSON.stringify({
  identifier: 'updater',
  windows: ['main'],
  platforms: ['macOS', 'windows', 'linux'],
  permissions: ['updater:default']
})

/**
 * Створює тимчасовий проєкт з опційним canonical Tauri-updater-layout-ом.
 * @param {{
 *   layout?: 'noTauri'|'canonical',
 *   packageJson?: Record<string, unknown>,
 *   cargoToml?: string,
 *   libRs?: string,
 *   appVue?: string|null,
 *   capabilities?: Record<string, string>
 * }} [opts] параметри layout'а
 * @returns {{dir: string, cleanup: () => void}} шлях до проєкту і cleanup
 */
function makeProj({
  layout = 'canonical',
  packageJson = PACKAGE_JSON,
  cargoToml = CARGO_TOML,
  libRs = LIB_RS,
  appVue = APP_VUE,
  capabilities = { 'default.json': DEFAULT_CAPABILITY, 'updater.json': UPDATER_CAPABILITY }
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tauri-updater-'))
  if (layout === 'noTauri') {
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  }
  mkdirSync(join(dir, 'app', 'src-tauri', 'src'), { recursive: true })
  mkdirSync(join(dir, 'app', 'src-tauri', 'capabilities'), { recursive: true })
  mkdirSync(join(dir, 'app', 'src'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app'] }))
  writeFileSync(join(dir, 'app', 'package.json'), JSON.stringify(packageJson))
  writeFileSync(join(dir, 'app', 'src-tauri', 'tauri.conf.json'), JSON.stringify({ version: '0.1.0' }))
  writeFileSync(join(dir, 'app', 'src-tauri', 'Cargo.toml'), cargoToml)
  writeFileSync(join(dir, 'app', 'src-tauri', 'src', 'lib.rs'), libRs)
  for (const [file, content] of Object.entries(capabilities)) {
    writeFileSync(join(dir, 'app', 'src-tauri', 'capabilities', file), content)
  }
  if (appVue !== null) {
    writeFileSync(join(dir, 'app', 'src', 'App.vue'), appVue)
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/**
 * Викликає detector `lint(ctx)` без `process.chdir` (test.mdc canon).
 * @param {string} dir каталог проєкту
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/types.mjs').LintViolation[]>} violations
 */
async function runCheckIn(dir) {
  const { violations } = await lint({ cwd: dir, ruleId: 'tauri', concernId: 'updater', files: undefined })
  return violations
}

describe('tauri updater concern', () => {
  test('немає tauri.conf.json — silent skip', async () => {
    const proj = makeProj({ layout: 'noTauri' })
    expect(await runCheckIn(proj.dir)).toEqual([])
    proj.cleanup()
  })

  test('канонічний layout — детектор чистий', async () => {
    const proj = makeProj()
    expect(await runCheckIn(proj.dir)).toEqual([])
    proj.cleanup()
  })

  test('@7n/tauri-components < 0.8 — tauri-components-version', async () => {
    const proj = makeProj({
      packageJson: { ...PACKAGE_JSON, dependencies: { ...PACKAGE_JSON.dependencies, '@7n/tauri-components': '^0.7.0' } }
    })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'tauri-components-version')).toBe(true)
    proj.cleanup()
  })

  test('@tauri-apps/plugin-updater відсутній — plugin-updater-missing', async () => {
    const deps = { ...PACKAGE_JSON.dependencies }
    delete deps['@tauri-apps/plugin-updater']
    const proj = makeProj({ packageJson: { ...PACKAGE_JSON, dependencies: deps } })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'plugin-updater-missing')).toBe(true)
    proj.cleanup()
  })

  test('tauri-plugin-process відсутній у Cargo.toml — cargo-plugin-process-missing', async () => {
    const broken = CARGO_TOML.replace('tauri-plugin-process = "2.3.1"\n', '')
    const proj = makeProj({ cargoToml: broken })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'cargo-plugin-process-missing')).toBe(true)
    proj.cleanup()
  })

  test('tauri-plugin-updater у безумовному [dependencies] — cargo-plugin-updater-not-scoped', async () => {
    const unscoped = `[package]
name = "app"
version = "0.1.0"

[dependencies]
tauri-plugin-process = "2.3.1"
tauri-plugin-updater = "2"
`
    const proj = makeProj({ cargoToml: unscoped })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'cargo-plugin-updater-not-scoped')).toBe(true)
    proj.cleanup()
  })

  test('tauri-plugin-updater відсутній у Cargo.toml — cargo-plugin-updater-missing', async () => {
    const broken = CARGO_TOML.replace(
      '[target.\'cfg(not(any(target_os = "android", target_os = "ios")))\'.dependencies]\ntauri-plugin-updater = "2"\n',
      ''
    )
    const proj = makeProj({ cargoToml: broken })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'cargo-plugin-updater-missing')).toBe(true)
    proj.cleanup()
  })

  test('tauri_plugin_process::init() відсутній у lib.rs — lib-rs-process-missing', async () => {
    const broken = LIB_RS.replace('let builder = builder.plugin(tauri_plugin_process::init());\n\n', '')
    const proj = makeProj({ libRs: broken })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'lib-rs-process-missing')).toBe(true)
    proj.cleanup()
  })

  test('tauri_plugin_updater::Builder без #[cfg(desktop)] — lib-rs-updater-not-guarded', async () => {
    const broken = LIB_RS.replace(
      '#[cfg(desktop)]\n    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());',
      'let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());'
    )
    const proj = makeProj({ libRs: broken })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'lib-rs-updater-not-guarded')).toBe(true)
    proj.cleanup()
  })

  test('capabilities без updater:default — capability-updater-missing', async () => {
    const proj = makeProj({ capabilities: { 'default.json': DEFAULT_CAPABILITY } })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'capability-updater-missing')).toBe(true)
    proj.cleanup()
  })

  test('capabilities без process:allow-restart — capability-process-restart-missing', async () => {
    const noRestart = JSON.stringify({ identifier: 'default', windows: ['main'], permissions: ['core:default'] })
    const proj = makeProj({ capabilities: { 'default.json': noRestart, 'updater.json': UPDATER_CAPABILITY } })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'capability-process-restart-missing')).toBe(true)
    proj.cleanup()
  })

  test('жоден *.vue не викликає useUpdater() — use-updater-not-called', async () => {
    const proj = makeProj({ appVue: '<script setup>\n// no updater here\n</script>\n' })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === 'use-updater-not-called')).toBe(true)
    proj.cleanup()
  })
})
