/**
 * Тести концерну `cargo_mutants_config` (test.mdc): self-gates через rust
 * у `.n-cursor.json#rules`, read-only detector ЗВІТУЄ про відсутній
 * <cargoDir>/.cargo/mutants.toml (`mutants-config-missing`), а T0-fix
 * (`fix-cargo_mutants_config.mjs`) копіює canonical baseline.
 */
import { describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MUTANTS_CONFIG_MISSING, lint } from '../main.mjs'
import { patterns } from '../fix-cargo_mutants_config.mjs'

/** Прогоняє T0-патерни concern-а над violations (як central fix-pipeline). */
async function applyT0(violations, dir) {
  const ctx = { cwd: dir, ruleId: 'test', concernId: 'cargo_mutants_config', recordWrite() {} }
  for (const p of patterns) {
    if (p.test(violations)) await p.apply(violations, ctx)
  }
}

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
 * Викликає detector `lint(ctx)` без `process.chdir` (test.mdc canon: production functions
 * приймають `cwd`; Stryker крутить тести у threads-pool, де chdir не підтримується).
 * @param {string} dir каталог проєкту
 * @returns {Promise<import('../../../../scripts/lib/lint-surface/types.mjs').LintViolation[]>} violations
 */
async function runCheckIn(dir) {
  const { violations } = await lint({ cwd: dir, ruleId: 'test', concernId: 'cargo_mutants_config', files: undefined })
  return violations
}

describe('cargo_mutants_config concern', () => {
  test('rust НЕ в rules — silent skip', async () => {
    const proj = makeProj({ rules: ['test'] })
    const violations = await runCheckIn(proj.dir)
    expect(violations).toEqual([])
    expect(existsSync(join(proj.dir, '.cargo', 'mutants.toml'))).toBe(false)
    proj.cleanup()
  })

  test('rust у disable-rules — silent skip', async () => {
    const proj = makeProj({ rules: ['rust'], disableRules: ['rust'] })
    const violations = await runCheckIn(proj.dir)
    expect(violations).toEqual([])
    proj.cleanup()
  })

  test('rust enabled + Cargo.toml у cwd, mutants.toml відсутній — detector звітує, нічого не пише', async () => {
    const proj = makeProj({ rules: ['rust'], layout: 'flat' })
    const violations = await runCheckIn(proj.dir)
    expect(violations.some(v => v.reason === MUTANTS_CONFIG_MISSING)).toBe(true)
    // read-only: detector НЕ створює файл
    expect(existsSync(join(proj.dir, '.cargo', 'mutants.toml'))).toBe(false)
    proj.cleanup()
  })

  test('T0 apply: rust enabled + Cargo.toml у cwd — створює cwd/.cargo/mutants.toml', async () => {
    const proj = makeProj({ rules: ['rust'], layout: 'flat' })
    const violations = await runCheckIn(proj.dir)
    await applyT0(violations, proj.dir)
    const target = join(proj.dir, '.cargo', 'mutants.toml')
    expect(existsSync(target)).toBe(true)
    const content = readFileSync(target, 'utf8')
    expect(content).toContain('cargo-mutants')
    // Neutral baseline: жодних framework-specific ключів (tauri-tuning живе у tauri-rule).
    expect(content).not.toContain('additional_cargo_test_args')
    expect(content).not.toContain('exclude_globs')
    proj.cleanup()
  })

  test('T0 apply: rust enabled + Tauri-патерн — створює app/src-tauri/.cargo/mutants.toml', async () => {
    const proj = makeProj({ rules: ['rust'], layout: 'tauri' })
    const violations = await runCheckIn(proj.dir)
    await applyT0(violations, proj.dir)
    expect(existsSync(join(proj.dir, 'app', 'src-tauri', '.cargo', 'mutants.toml'))).toBe(true)
    proj.cleanup()
  })

  test('T0 apply: .cargo/ існує — не псує існуючі файли всередині', async () => {
    const proj = makeProj({ rules: ['rust'], layout: 'flat' })
    const cargoDir = join(proj.dir, '.cargo')
    mkdirSync(cargoDir, { recursive: true })
    writeFileSync(join(cargoDir, 'config.toml'), '[build]\ntarget = "x86_64-unknown-linux-gnu"\n')
    const violations = await runCheckIn(proj.dir)
    await applyT0(violations, proj.dir)
    expect(existsSync(join(cargoDir, 'mutants.toml'))).toBe(true)
    expect(readFileSync(join(cargoDir, 'config.toml'), 'utf8')).toContain('[build]')
    proj.cleanup()
  })

  test('rust enabled + mutants.toml існує — detector чистий, T0 не перезаписує', async () => {
    const proj = makeProj({ rules: ['rust'], layout: 'flat' })
    const cargoDir = join(proj.dir, '.cargo')
    mkdirSync(cargoDir, { recursive: true })
    writeFileSync(join(cargoDir, 'mutants.toml'), '# my custom config')
    const violations = await runCheckIn(proj.dir)
    expect(violations).toEqual([])
    await applyT0(violations, proj.dir)
    expect(readFileSync(join(cargoDir, 'mutants.toml'), 'utf8')).toBe('# my custom config')
    proj.cleanup()
  })

  test('rust enabled, але Cargo.toml відсутній — silent skip (не fail)', async () => {
    const proj = makeProj({ rules: ['rust'], layout: 'noCargo' })
    const violations = await runCheckIn(proj.dir)
    expect(violations).toEqual([])
    proj.cleanup()
  })

  test('T0 apply: кілька Cargo.toml (root + Tauri + flat workspace) — створює у КОЖЕН', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutants-multi-'))
    writeFileSync(join(dir, '.n-cursor.json'), JSON.stringify({ rules: ['rust'] }))
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="r"\nversion="0.1.0"\n')
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['tauri-app', 'cli'] }))
    mkdirSync(join(dir, 'tauri-app', 'src-tauri'), { recursive: true })
    writeFileSync(join(dir, 'tauri-app', 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\nversion="0.1.0"\n')
    mkdirSync(join(dir, 'cli'), { recursive: true })
    writeFileSync(join(dir, 'cli', 'Cargo.toml'), '[package]\nname="c"\nversion="0.1.0"\n')

    const violations = await runCheckIn(dir)
    expect(violations.filter(v => v.reason === MUTANTS_CONFIG_MISSING).length).toBe(3)
    await applyT0(violations, dir)
    expect(existsSync(join(dir, '.cargo', 'mutants.toml'))).toBe(true)
    expect(existsSync(join(dir, 'tauri-app', 'src-tauri', '.cargo', 'mutants.toml'))).toBe(true)
    expect(existsSync(join(dir, 'cli', '.cargo', 'mutants.toml'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})
