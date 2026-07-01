/**
 * Тести Tauri-концерну `cargo_mutants_config` (tauri.mdc):
 *   - silent skip коли в монорепо не знайдено жодного src-tauri/Cargo.toml;
 *   - створення Tauri-baseline (additional_cargo_test_args + exclude_globs)
 *     у <ws>/src-tauri/.cargo/mutants.toml коли файл відсутній;
 *   - ідемпотентність: повторний прогон не змінює файл;
 *   - збереження ручних налаштувань: існуючі канонічні ключі не перетираються;
 *   - augmentation: якщо частина канонічних ключів відсутня — додаються тільки
 *     відсутні, інші лишаються байтово незмінними;
 *   - кілька src-tauri у різних workspace-пакетах оброблюються незалежно.
 */
import { describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parse as parseToml } from 'smol-toml'

import { MUTANTS_CONFIG_MISSING, MUTANTS_KEYS_MISSING, lint } from '../main.mjs'
import { patterns } from '../fix-cargo_mutants_config.mjs'

/**
 * Прогоняє T0-патерни concern-а над violations (як central fix-pipeline).
 * @param {import('../../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} violations порушення для фіксу.
 * @param {string} dir корінь тимчасового проєкту.
 * @returns {Promise<void>} завершується після застосування всіх патернів.
 */
async function applyT0(violations, dir) {
  const ctx = {
    cwd: dir,
    ruleId: 'tauri',
    concernId: 'cargo_mutants_config',
    recordWrite() {
      // no-op: тест не відстежує записи fix-pipeline
    }
  }
  for (const p of patterns) {
    if (p.test(violations)) await p.apply(violations, ctx)
  }
}

/**
 * Створює тимчасовий проєкт з опційним Tauri-layout-ом.
 * @param {{layout?: 'noTauri'|'tauri'|'multiTauri', tauriManifest?: string}} [opts] параметри layout'а
 * @returns {{dir: string, cleanup: () => void}} шлях до проєкту і cleanup
 */
function makeProj({ layout = 'tauri', tauriManifest = '[package]\nname="t"\nversion="0.1.0"\n' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tauri-mutants-config-'))
  switch (layout) {
    case 'noTauri': {
      // Жодного маркера Tauri.

      break
    }
    case 'tauri': {
      // Реальний Tauri monorepo: workspace `app` має власний package.json (JS-frontend) + src-tauri (Rust-backend).
      mkdirSync(join(dir, 'app', 'src-tauri'), { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app'] }))
      writeFileSync(join(dir, 'app', 'package.json'), JSON.stringify({ name: 'app', version: '0.0.0' }))
      writeFileSync(join(dir, 'app', 'src-tauri', 'Cargo.toml'), tauriManifest)

      break
    }
    case 'multiTauri': {
      mkdirSync(join(dir, 'app', 'src-tauri'), { recursive: true })
      mkdirSync(join(dir, 'desktop', 'src-tauri'), { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app', 'desktop'] }))
      writeFileSync(join(dir, 'app', 'package.json'), JSON.stringify({ name: 'app', version: '0.0.0' }))
      writeFileSync(join(dir, 'desktop', 'package.json'), JSON.stringify({ name: 'desktop', version: '0.0.0' }))
      writeFileSync(join(dir, 'app', 'src-tauri', 'Cargo.toml'), '[package]\nname="a"\nversion="0.1.0"\n')
      writeFileSync(join(dir, 'desktop', 'src-tauri', 'Cargo.toml'), '[package]\nname="d"\nversion="0.1.0"\n')

      break
    }
    // No default
  }
  return {
    dir,
    cleanup() {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

/**
 * Викликає detector `lint(ctx)` без `process.chdir` (test.mdc canon: production functions
 * приймають `cwd`; Stryker крутить тести у threads-pool, де chdir не підтримується).
 * @param {string} dir каталог проєкту
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/types.mjs').LintViolation[]>} violations
 */
async function runCheckIn(dir) {
  const { violations } = await lint({ cwd: dir, ruleId: 'tauri', concernId: 'cargo_mutants_config', files: undefined })
  return violations
}

describe('tauri cargo_mutants_config concern', () => {
  test('немає src-tauri/ — silent skip', async () => {
    const proj = makeProj({ layout: 'noTauri' })
    const violations = await runCheckIn(proj.dir)
    expect(violations).toEqual([])
    proj.cleanup()
  })

  test('src-tauri є, mutants.toml відсутній — detector звітує, нічого не пише', async () => {
    const proj = makeProj({ layout: 'tauri' })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === MUTANTS_CONFIG_MISSING)).toBe(true)
    expect(existsSync(join(proj.dir, 'app', 'src-tauri', '.cargo', 'mutants.toml'))).toBe(false)
    proj.cleanup()
  })

  test('T0 apply: mutants.toml відсутній — створено Tauri canonical baseline', async () => {
    const proj = makeProj({ layout: 'tauri' })
    const violations = await runCheckIn(proj.dir)
    await applyT0(violations, proj.dir)
    const target = join(proj.dir, 'app', 'src-tauri', '.cargo', 'mutants.toml')
    expect(existsSync(target)).toBe(true)
    const parsed = parseToml(readFileSync(target, 'utf8'))
    expect(parsed.additional_cargo_test_args).toEqual(['--lib', '--tests'])
    expect(parsed.exclude_globs).toContain('src/main.rs')
    expect(parsed.exclude_globs).toContain('src/lib.rs')
    expect(parsed.exclude_globs).toContain('src/**/android.rs')
    expect(parsed.exclude_globs).toContain('src/**/macos.rs')
    proj.cleanup()
  })

  test('T0 apply: повторний прогон — байт-в-байт ідемпотентний, detector чистий', async () => {
    const proj = makeProj({ layout: 'tauri' })
    await applyT0(await runCheckIn(proj.dir), proj.dir)
    const target = join(proj.dir, 'app', 'src-tauri', '.cargo', 'mutants.toml')
    const first = readFileSync(target, 'utf8')
    const violations2 = await runCheckIn(proj.dir)
    expect(violations2).toEqual([])
    await applyT0(violations2, proj.dir)
    expect(readFileSync(target, 'utf8')).toBe(first)
    proj.cleanup()
  })

  test('усі канонічні ключі вже є з manual values — detector чистий, T0 нічого не перетирає', async () => {
    const proj = makeProj({ layout: 'tauri' })
    const target = join(proj.dir, 'app', 'src-tauri', '.cargo', 'mutants.toml')
    mkdirSync(join(target, '..'), { recursive: true })
    const manual = `# manual cargo-mutants tuning
additional_cargo_test_args = ["--lib"]
exclude_globs = ["src/custom.rs"]
timeout_multiplier = 5.0
`
    writeFileSync(target, manual)
    const violations = await runCheckIn(proj.dir)
    expect(violations).toEqual([])
    await applyT0(violations, proj.dir)
    expect(readFileSync(target, 'utf8')).toBe(manual)
    proj.cleanup()
  })

  test('частково сконфігурований файл — detector звітує keys-missing, T0 додає лише відсутні ключі', async () => {
    const proj = makeProj({ layout: 'tauri' })
    const target = join(proj.dir, 'app', 'src-tauri', '.cargo', 'mutants.toml')
    mkdirSync(join(target, '..'), { recursive: true })
    const manual = `additional_cargo_test_args = ["--lib"]
timeout_multiplier = 5.0
`
    writeFileSync(target, manual)
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === MUTANTS_KEYS_MISSING)).toBe(true)
    // read-only: detector не торкнувся файла
    expect(readFileSync(target, 'utf8')).toBe(manual)
    await applyT0(violations, proj.dir)
    const after = readFileSync(target, 'utf8')
    // Existing keys preserved.
    expect(after).toContain('additional_cargo_test_args = ["--lib"]')
    expect(after).toContain('timeout_multiplier = 5.0')
    // Missing canonical key was appended.
    const parsed = parseToml(after)
    expect(parsed.exclude_globs).toContain('src/main.rs')
    // Manual additional_cargo_test_args не змінилось (TOML дозволив би duplicate-key error — перевіряємо первинне значення).
    expect(parsed.additional_cargo_test_args).toEqual(['--lib'])
    proj.cleanup()
  })

  test("T0 apply: кілька src-tauri у різних workspaces — у кожному з'являється Tauri-config", async () => {
    const proj = makeProj({ layout: 'multiTauri' })
    const violations = await runCheckIn(proj.dir)
    expect(violations.filter(v => v.reason === MUTANTS_CONFIG_MISSING).length).toBe(2)
    await applyT0(violations, proj.dir)
    expect(existsSync(join(proj.dir, 'app', 'src-tauri', '.cargo', 'mutants.toml'))).toBe(true)
    expect(existsSync(join(proj.dir, 'desktop', 'src-tauri', '.cargo', 'mutants.toml'))).toBe(true)
    proj.cleanup()
  })

  test('T0 apply: test-rule baseline + tauri-rule augmentation — ключі додаються поверх нейтрального файла', async () => {
    const proj = makeProj({ layout: 'tauri' })
    const target = join(proj.dir, 'app', 'src-tauri', '.cargo', 'mutants.toml')
    mkdirSync(join(target, '..'), { recursive: true })
    // Симулюємо нейтральний test-rule baseline (тільки коментар).
    const neutral = '# .cargo/mutants.toml — universal cargo-mutants baseline (test.mdc).\n'
    writeFileSync(target, neutral)
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === MUTANTS_KEYS_MISSING)).toBe(true)
    await applyT0(violations, proj.dir)
    const after = readFileSync(target, 'utf8')
    expect(after.startsWith(neutral)).toBe(true)
    const parsed = parseToml(after)
    expect(parsed.additional_cargo_test_args).toEqual(['--lib', '--tests'])
    expect(parsed.exclude_globs).toContain('src/**/android.rs')
    proj.cleanup()
  })
})
