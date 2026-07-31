/**
 * Тести `build-wasm-plugins.mjs` (задача O1 фази 6 v2, спека
 * `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md` §3.4,
 * рішення Н) — увесь `cargo`/`build.sh`-тулчейн ін'єктується фейковим
 * `spawnFn` (той самий DI-мотив, що `release-smoke.test.mjs`): жодного
 * реального `cargo build`/wasm32-wasip2 тулчейну тут не потрібно, лише
 * перевірка, що скрипт правильно оркеструє build.sh → `cargo metadata` →
 * копіювання артефакту → `builtin-pins.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

import { describe, expect, test, vi } from 'vitest'

import {
  FIRST_PARTY_WASM_PLUGINS,
  buildAndStage,
  main,
  readCargoPackageName,
  readCargoTargetDir
} from '../build-wasm-plugins.mjs'
import { withTmpDir } from '../utils/test-helpers.mjs'

/**
 * Пише мінімальний `Cargo.toml` з заданим `name` у `crateDir`.
 * @param {string} crateDir абсолютний шлях крейта
 * @param {string} name значення поля `name`
 * @returns {void}
 */
function writeCargoToml(crateDir, name) {
  mkdirSync(crateDir, { recursive: true })
  writeFileSync(join(crateDir, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "0.1.0"\n`, 'utf8')
}

/**
 * Фейковий `spawnFn` для [`buildAndStage`]: перший виклик (build.sh за шляхом
 * `buildScript`) симулює успішну збірку, записуючи `wasmBytes` за очікуваним
 * шляхом cargo-виводу (`<targetDir>/wasm32-wasip2/release/<stem>.wasm`);
 * другий (`cargo metadata`) повертає `targetDir` у JSON-виводі.
 * @param {{ buildScript: string, targetDir: string, wasmStem: string, wasmBytes: string, buildStatus?: number, produceArtifact?: boolean }} cfg параметри фейкового сценарію збірки
 * @returns {import('vitest').Mock} фейк `spawnFn`
 */
function fakeSpawn(cfg) {
  return vi.fn((cmd, args, opts) => {
    if (cmd === cfg.buildScript) {
      if ((cfg.buildStatus ?? 0) === 0 && cfg.produceArtifact !== false) {
        const dir = join(cfg.targetDir, 'wasm32-wasip2', 'release')
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, `${cfg.wasmStem}.wasm`), cfg.wasmBytes)
      }
      return { status: cfg.buildStatus ?? 0 }
    }
    if (cmd === 'cargo') {
      return { status: 0, stdout: JSON.stringify({ target_directory: cfg.targetDir }) }
    }
    throw new Error(`неочікуваний spawn: ${cmd} ${JSON.stringify(args)} (cwd=${opts?.cwd})`)
  })
}

describe('readCargoPackageName', () => {
  test('парсить "name" з Cargo.toml', async () => {
    await withTmpDir(dir => {
      writeCargoToml(dir, 'plugin-foo-bar')
      expect(readCargoPackageName(dir)).toBe('plugin-foo-bar')
    })
  })

  test('немає поля "name" → кидає', async () => {
    await withTmpDir(dir => {
      writeFileSync(join(dir, 'Cargo.toml'), '[package]\nversion = "0.1.0"\n', 'utf8')
      expect(() => readCargoPackageName(dir)).toThrow('name')
    })
  })
})

describe('readCargoTargetDir', () => {
  test("парсить target_directory з cargo metadata (fetchFn-ін'єкція)", async () => {
    await withTmpDir(dir => {
      const spawnFn = vi.fn(() => ({ status: 0, stdout: JSON.stringify({ target_directory: '/fake/target' }) }))
      expect(readCargoTargetDir(dir, spawnFn)).toBe('/fake/target')
      expect(spawnFn).toHaveBeenCalledWith(
        'cargo',
        ['metadata', '--no-deps', '--format-version=1'],
        expect.objectContaining({ cwd: dir })
      )
    })
  })

  test('cargo metadata впав (status != 0) → кидає', async () => {
    await withTmpDir(dir => {
      const spawnFn = vi.fn(() => ({ status: 1, stderr: 'boom' }))
      expect(() => readCargoTargetDir(dir, spawnFn)).toThrow('cargo metadata впав')
    })
  })
})

describe('buildAndStage', () => {
  test('happy path: build.sh → cargo metadata → копія в wasmPluginsDir + sha256', async () => {
    await withTmpDir(repoRoot => {
      const plugin = { name: 'lang-js', crateDir: 'crates/plugin-lang-js' }
      const crateDir = join(repoRoot, plugin.crateDir)
      writeCargoToml(crateDir, 'plugin-lang-js')
      const buildScript = join(crateDir, 'build.sh')
      const targetDir = join(crateDir, 'target')
      const wasmBytes = 'FAKE-WASM-BYTES-lang-js'
      const spawnFn = fakeSpawn({ buildScript, targetDir, wasmStem: 'plugin_lang_js', wasmBytes })
      const wasmPluginsDir = join(repoRoot, 'wasm-plugins-out')

      const result = buildAndStage(plugin, { spawnFn, repoRoot, wasmPluginsDir })

      expect(result).toEqual({
        name: 'lang-js',
        file: 'plugin-lang-js.wasm',
        sha256: createHash('sha256').update(wasmBytes).digest('hex')
      })
      const destPath = join(wasmPluginsDir, 'plugin-lang-js.wasm')
      expect(existsSync(destPath)).toBe(true)
      expect(readFileSync(destPath, 'utf8')).toBe(wasmBytes)
    })
  })

  test('build.sh падає (status != 0) → кидає, wasmPluginsDir не займано', async () => {
    await withTmpDir(repoRoot => {
      const plugin = { name: 'lang-js', crateDir: 'crates/plugin-lang-js' }
      const crateDir = join(repoRoot, plugin.crateDir)
      writeCargoToml(crateDir, 'plugin-lang-js')
      const buildScript = join(crateDir, 'build.sh')
      const targetDir = join(crateDir, 'target')
      const spawnFn = fakeSpawn({ buildScript, targetDir, wasmStem: 'plugin_lang_js', wasmBytes: 'x', buildStatus: 1 })
      const wasmPluginsDir = join(repoRoot, 'wasm-plugins-out')

      expect(() => buildAndStage(plugin, { spawnFn, repoRoot, wasmPluginsDir })).toThrow('build.sh')
      expect(existsSync(wasmPluginsDir)).toBe(false)
    })
  })

  test('build.sh "успішний", але артефакт відсутній за очікуваним шляхом → кидає', async () => {
    await withTmpDir(repoRoot => {
      const plugin = { name: 'lang-js', crateDir: 'crates/plugin-lang-js' }
      const crateDir = join(repoRoot, plugin.crateDir)
      writeCargoToml(crateDir, 'plugin-lang-js')
      const buildScript = join(crateDir, 'build.sh')
      const targetDir = join(crateDir, 'target')
      const spawnFn = fakeSpawn({
        buildScript,
        targetDir,
        wasmStem: 'plugin_lang_js',
        wasmBytes: 'x',
        produceArtifact: false
      })

      expect(() => buildAndStage(plugin, { spawnFn, repoRoot, wasmPluginsDir: join(repoRoot, 'out') })).toThrow(
        'очікуваний артефакт не знайдено'
      )
    })
  })
})

describe('main', () => {
  test('пише builtin-pins.json з записами всіх зібраних плагінів', async () => {
    await withTmpDir(repoRoot => {
      const plugin = { name: 'lang-js', crateDir: 'crates/plugin-lang-js' }
      const crateDir = join(repoRoot, plugin.crateDir)
      writeCargoToml(crateDir, 'plugin-lang-js')
      const buildScript = join(crateDir, 'build.sh')
      const targetDir = join(crateDir, 'target')
      const wasmBytes = 'FAKE-WASM-BYTES-lang-js'
      const spawnFn = fakeSpawn({ buildScript, targetDir, wasmStem: 'plugin_lang_js', wasmBytes })
      const wasmPluginsDir = join(repoRoot, 'wasm-plugins-out')

      const pinsPath = main([plugin], { spawnFn, repoRoot, wasmPluginsDir })

      expect(pinsPath).toBe(join(wasmPluginsDir, 'builtin-pins.json'))
      const pins = JSON.parse(readFileSync(pinsPath, 'utf8'))
      expect(pins).toEqual({
        'lang-js': { file: 'plugin-lang-js.wasm', sha256: createHash('sha256').update(wasmBytes).digest('hex') }
      })
    })
  })
})

describe('FIRST_PARTY_WASM_PLUGINS', () => {
  test('декларує lang-js (crates/plugin-lang-js) — сьогоднішній єдиний first-party плагін', () => {
    expect(FIRST_PARTY_WASM_PLUGINS).toEqual([{ name: 'lang-js', crateDir: 'crates/plugin-lang-js' }])
  })
})
