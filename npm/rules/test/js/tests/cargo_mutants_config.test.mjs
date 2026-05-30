/**
 * Тести концерну `cargo_mutants_config` (test.mdc): self-gates через rust
 * у `.n-cursor.json#rules`, side-effect-копіює canonical baseline у
 * <cargoDir>/.cargo/mutants.toml якщо відсутній.
 */
import { describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { check } from '../cargo_mutants_config.mjs'

/**
 * Створює тимчасовий проєкт з опційним Cargo-layout-ом.
 * @param {{rules?: string[], disableRules?: string[], layout?: 'flat'|'tauri'|'noCargo'}} [opts] параметри генерації проєкту
 * @returns {{dir: string, cleanup: () => void}} шлях до проєкту і cleanup
 */
function makeProj({ rules = [], disableRules = [], layout = 'flat' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mutants-config-concern-'))
  writeFileSync(join(dir, '.n-cursor.json'), JSON.stringify({ rules, 'disable-rules': disableRules }))
  if (layout === 'flat') {
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="x"\nversion="0.1.0"\n')
  } else if (layout === 'tauri') {
    mkdirSync(join(dir, 'app', 'src-tauri'), { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app'] }))
    writeFileSync(join(dir, 'app', 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\nversion="0.1.0"\n')
  }
  // layout === 'noCargo' — нічого не створюємо
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
function runCheckIn(dir) {
  return check(dir)
}

describe('cargo_mutants_config concern', () => {
  test('rust НЕ в rules — silent skip', async () => {
    const proj = makeProj({ rules: ['test'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(proj.dir, '.cargo', 'mutants.toml'))).toBe(false)
    proj.cleanup()
  })

  test('rust у disable-rules — silent skip', async () => {
    const proj = makeProj({ rules: ['rust'], disableRules: ['rust'] })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    proj.cleanup()
  })

  test('rust enabled + Cargo.toml у cwd — копіює baseline у cwd/.cargo/mutants.toml', async () => {
    const proj = makeProj({ rules: ['rust'], layout: 'flat' })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    const target = join(proj.dir, '.cargo', 'mutants.toml')
    expect(existsSync(target)).toBe(true)
    const content = readFileSync(target, 'utf8')
    expect(content).toContain('cargo-mutants')
    // Neutral baseline: жодних framework-specific ключів (tauri-tuning живе у tauri-rule).
    expect(content).not.toContain('additional_cargo_test_args')
    expect(content).not.toContain('exclude_globs')
    proj.cleanup()
  })

  test('rust enabled + Tauri-патерн — копіює у app/src-tauri/.cargo/mutants.toml', async () => {
    const proj = makeProj({ rules: ['rust'], layout: 'tauri' })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(proj.dir, 'app', 'src-tauri', '.cargo', 'mutants.toml'))).toBe(true)
    proj.cleanup()
  })

  test('rust enabled + .cargo/ існує — не псує існуючі файли всередині', async () => {
    const proj = makeProj({ rules: ['rust'], layout: 'flat' })
    const cargoDir = join(proj.dir, '.cargo')
    mkdirSync(cargoDir, { recursive: true })
    writeFileSync(join(cargoDir, 'config.toml'), '[build]\ntarget = "x86_64-unknown-linux-gnu"\n')
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(cargoDir, 'mutants.toml'))).toBe(true)
    expect(readFileSync(join(cargoDir, 'config.toml'), 'utf8')).toContain('[build]')
    proj.cleanup()
  })

  test('rust enabled + mutants.toml існує — не перезаписує', async () => {
    const proj = makeProj({ rules: ['rust'], layout: 'flat' })
    const cargoDir = join(proj.dir, '.cargo')
    mkdirSync(cargoDir, { recursive: true })
    writeFileSync(join(cargoDir, 'mutants.toml'), '# my custom config')
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    expect(readFileSync(join(cargoDir, 'mutants.toml'), 'utf8')).toBe('# my custom config')
    proj.cleanup()
  })

  test('rust enabled, але Cargo.toml відсутній — silent skip (не fail)', async () => {
    const proj = makeProj({ rules: ['rust'], layout: 'noCargo' })
    const exitCode = await runCheckIn(proj.dir)
    expect(exitCode).toBe(0)
    proj.cleanup()
  })

  test('rust enabled + кілька Cargo.toml (root + Tauri + flat workspace) — копіює у КОЖЕН', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutants-multi-'))
    writeFileSync(join(dir, '.n-cursor.json'), JSON.stringify({ rules: ['rust'] }))
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="r"\nversion="0.1.0"\n')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['tauri-app', 'cli'] }))
    mkdirSync(join(dir, 'tauri-app', 'src-tauri'), { recursive: true })
    writeFileSync(join(dir, 'tauri-app', 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\nversion="0.1.0"\n')
    mkdirSync(join(dir, 'cli'), { recursive: true })
    writeFileSync(join(dir, 'cli', 'Cargo.toml'), '[package]\nname="c"\nversion="0.1.0"\n')

    const exitCode = await runCheckIn(dir)
    expect(exitCode).toBe(0)
    expect(existsSync(join(dir, '.cargo', 'mutants.toml'))).toBe(true)
    expect(existsSync(join(dir, 'tauri-app', 'src-tauri', '.cargo', 'mutants.toml'))).toBe(true)
    expect(existsSync(join(dir, 'cli', '.cargo', 'mutants.toml'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})
