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

import { check } from '../cargo_mutants_config.mjs'

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
 * Викликає `check(dir)` без `process.chdir` (test.mdc canon: production functions
 * приймають перший параметр `cwd = process.cwd()`; Stryker крутить тести у threads-pool,
 * де chdir не підтримується).
 * @param {string} dir каталог проєкту
 * @returns {Promise<number>} exit code
 */
async function runCheckIn(dir) {
  return check(dir)
}

describe('tauri cargo_mutants_config concern', () => {
  test('немає src-tauri/ — silent skip', async () => {
    const proj = makeProj({ layout: 'noTauri' })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    proj.cleanup()
  })

  test('src-tauri є, mutants.toml відсутній — створено Tauri canonical baseline', async () => {
    const proj = makeProj({ layout: 'tauri' })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
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

  test('повторний прогон — байт-в-байт ідемпотентний', async () => {
    const proj = makeProj({ layout: 'tauri' })
    await runCheckIn(proj.dir)
    const target = join(proj.dir, 'app', 'src-tauri', '.cargo', 'mutants.toml')
    const first = readFileSync(target, 'utf8')
    await runCheckIn(proj.dir)
    const second = readFileSync(target, 'utf8')
    expect(second).toBe(first)
    proj.cleanup()
  })

  test('усі канонічні ключі вже є з manual values — нічого не перетирає', async () => {
    const proj = makeProj({ layout: 'tauri' })
    const target = join(proj.dir, 'app', 'src-tauri', '.cargo', 'mutants.toml')
    mkdirSync(join(target, '..'), { recursive: true })
    const manual = `# manual cargo-mutants tuning
additional_cargo_test_args = ["--lib"]
exclude_globs = ["src/custom.rs"]
timeout_multiplier = 5.0
`
    writeFileSync(target, manual)
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe(manual)
    proj.cleanup()
  })

  test('частково сконфігурований файл — додаються лише відсутні ключі', async () => {
    const proj = makeProj({ layout: 'tauri' })
    const target = join(proj.dir, 'app', 'src-tauri', '.cargo', 'mutants.toml')
    mkdirSync(join(target, '..'), { recursive: true })
    const manual = `additional_cargo_test_args = ["--lib"]
timeout_multiplier = 5.0
`
    writeFileSync(target, manual)
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
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

  test("кілька src-tauri у різних workspaces — у кожному з'являється Tauri-config", async () => {
    const proj = makeProj({ layout: 'multiTauri' })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(proj.dir, 'app', 'src-tauri', '.cargo', 'mutants.toml'))).toBe(true)
    expect(existsSync(join(proj.dir, 'desktop', 'src-tauri', '.cargo', 'mutants.toml'))).toBe(true)
    proj.cleanup()
  })

  test('test-rule baseline + tauri-rule augmentation: ключі додаються поверх нейтрального файла', async () => {
    const proj = makeProj({ layout: 'tauri' })
    const target = join(proj.dir, 'app', 'src-tauri', '.cargo', 'mutants.toml')
    mkdirSync(join(target, '..'), { recursive: true })
    // Симулюємо нейтральний test-rule baseline (тільки коментар).
    const neutral = '# .cargo/mutants.toml — universal cargo-mutants baseline (test.mdc).\n'
    writeFileSync(target, neutral)
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    const after = readFileSync(target, 'utf8')
    expect(after.startsWith(neutral)).toBe(true)
    const parsed = parseToml(after)
    expect(parsed.additional_cargo_test_args).toEqual(['--lib', '--tests'])
    expect(parsed.exclude_globs).toContain('src/**/android.rs')
    proj.cleanup()
  })
})
