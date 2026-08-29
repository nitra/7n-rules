/**
 * Тести native-фіксу `tauri/updater` (§2.79,
 * `crates/rules-core/src/concerns/fix_tauri_updater.rs`).
 *
 * ПРОДАКШН-шлях: `loadT0Patterns` → `getNativeFixKeys()` (`listNativeFixes()`)
 * → синтетичний `nativeFixPattern` → napi, не пряме звернення до Rust-функції
 * (§2.47). Тут — проводка й по одному представнику кожного з чотирьох
 * патернів канону; вичерпна поведінка (перенесення рядка Cargo.toml,
 * idempotent-guard, побитий capability) покрита юніт-тестами в Rust.
 */
import { expect, test, vi } from 'vitest'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadT0Patterns } from '../../../../scripts/lib/lint-surface/run-fix.mjs'
import { withTmpDir } from '../../../../scripts/utils/test-helpers.mjs'

const CONCERN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const ruleId = 'tauri'
const concernId = 'updater'

const patternsFor = dir => loadT0Patterns(CONCERN_DIR, concernId, ruleId, dir)
const apply = (pattern, dir, violations) =>
  pattern.apply(violations, { cwd: dir, ruleId, concernId, recordWrite: vi.fn() })
const readJson = (dir, rel) => JSON.parse(readFileSync(join(dir, rel), 'utf8'))

/** Мінімальний Tauri-застосунок у корені tmp-репо. */
function scaffold(dir) {
  mkdirSync(join(dir, 'src-tauri/src'), { recursive: true })
  mkdirSync(join(dir, 'src-tauri/capabilities'), { recursive: true })
  writeFileSync(join(dir, 'src-tauri/tauri.conf.json'), '{}', 'utf8')
  writeFileSync(join(dir, 'package.json'), '{\n  "name": "app"\n}\n', 'utf8')
}

const violation = (reason, file) => ({ ruleId, concernId, reason, message: 'm', file })

test('loadT0Patterns повертає синтетичний native-fix pattern, не fix-updater.mjs', async () => {
  await withTmpDir(async dir => {
    scaffold(dir)
    const patterns = await patternsFor(dir)
    expect(patterns).toHaveLength(1)
    expect(patterns[0].id).toBe(`native-fix:${ruleId}/${concernId}`)
  })
})

test('package.json — канонічні updater-залежності дописано', async () => {
  await withTmpDir(async dir => {
    scaffold(dir)
    const [pattern] = await patternsFor(dir)
    const v = [violation('plugin-updater-missing', 'package.json')]
    expect(pattern.test(v)).toBe(true)
    await apply(pattern, dir, v)
    const pkg = readJson(dir, 'package.json')
    expect(pkg.name).toBe('app')
    expect(pkg.dependencies['@tauri-apps/plugin-updater']).toBe('^2')
    expect(pkg.dependencies['@tauri-apps/plugin-process']).toBe('^2')
    expect(pkg.dependencies['@7n/tauri-components']).toBe('^0.8.0')
  })
})

test('Cargo.toml — updater потрапляє у desktop-only target-секцію', async () => {
  await withTmpDir(async dir => {
    scaffold(dir)
    writeFileSync(join(dir, 'src-tauri/Cargo.toml'), '[dependencies]\ntauri = "2"\n', 'utf8')
    const [pattern] = await patternsFor(dir)
    await apply(pattern, dir, [violation('cargo-plugin-updater-missing', 'src-tauri/Cargo.toml')])
    const toml = readFileSync(join(dir, 'src-tauri/Cargo.toml'), 'utf8')
    expect(toml).toContain('tauri = "2"')
    expect(toml).toContain('tauri-plugin-process = "2.3.1"')
    expect(toml).toContain('target.\'cfg(not(any(target_os = "android", target_os = "ios")))\'.dependencies')
    expect(toml).toContain('tauri-plugin-updater = "2"')
  })
})

test('lib.rs — #[cfg(desktop)] над наявним рядком реєстрації', async () => {
  await withTmpDir(async dir => {
    scaffold(dir)
    writeFileSync(
      join(dir, 'src-tauri/src/lib.rs'),
      'pub fn run() {\n    let b = b.plugin(tauri_plugin_updater::Builder::new().build());\n}\n',
      'utf8'
    )
    const [pattern] = await patternsFor(dir)
    await apply(pattern, dir, [violation('lib-rs-updater-not-guarded', 'src-tauri/src/lib.rs')])
    const lib = readFileSync(join(dir, 'src-tauri/src/lib.rs'), 'utf8')
    expect(lib).toContain('    #[cfg(desktop)]\n    let b = b.plugin(tauri_plugin_updater')
  })
})

test('capabilities — updater.json створено, default.json домержено', async () => {
  await withTmpDir(async dir => {
    scaffold(dir)
    writeFileSync(
      join(dir, 'src-tauri/capabilities/default.json'),
      JSON.stringify({ identifier: 'default', permissions: ['core:default'] }),
      'utf8'
    )
    const [pattern] = await patternsFor(dir)
    await apply(pattern, dir, [
      violation('capability-updater-missing', 'src-tauri/capabilities'),
      violation('capability-process-restart-missing', 'src-tauri/capabilities')
    ])
    expect(readJson(dir, 'src-tauri/capabilities/updater.json').permissions).toEqual(['updater:default'])
    expect(readJson(dir, 'src-tauri/capabilities/default.json').permissions).toEqual([
      'core:default',
      'process:allow-restart'
    ])
  })
})

test('не-T0 причини (use-updater-not-called) лишаються manual', async () => {
  await withTmpDir(async dir => {
    scaffold(dir)
    const [pattern] = await patternsFor(dir)
    expect(pattern.test([violation('use-updater-not-called', 'src/App.vue')])).toBe(false)
  })
})
