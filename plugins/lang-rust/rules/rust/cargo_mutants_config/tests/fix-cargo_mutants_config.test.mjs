/**
 * Тести T0-фіксера `rust.cargo_mutants_config` (`fix-cargo_mutants_config.mjs`
 * — лишається JS-каноном: `Guest::fix` гостя `crates/plugin-lang-rust` для
 * цього концерну свідомо віддає порожній план, а сам baseline-шаблон живе
 * усередині npm-пакета плагіна, куди гість не дістає).
 *
 * Виділені з `cargo_mutants_config.test.mjs` при знятті JS-детектора. Той
 * файл будував вхід фіксера викликом детектора; тут `violations` задані
 * ЛІТЕРАЛЬНО (форма знята з фактичного виводу `runWasmConcern`), бо в
 * продакшені їх дає саме гість.
 *
 * Важлива деталь, чому літерал тут ДОСТАТНІЙ, а не спрощення: `apply`
 * фіксера НЕ читає `violations` крім `test()` — він сам резолвить маніфести
 * через `resolveAllCargoManifests(ctx.cwd)`. Тобто фікстури нижче перевіряють
 * рівно те, що фіксер і робить, а перелік маніфестів приходить із диска, як
 * і в продакшені.
 *
 * Два сценарії старого файлу СВІДОМО не перенесені: self-gate по
 * `.n-rules.json` (`rust` не в `rules` / у `disable-rules`) — цю поведінку
 * знято з гостя як надлишкову, бо host фільтрує правила у `enabledRuleIds`
 * ДО `buildLintPlan` (реєстр §2.17).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { patterns } from '../fix-cargo_mutants_config.mjs'

/** Одне порушення у формі, яку віддає гість (`mutants-config-missing`). */
const missing = file => ({
  reason: 'mutants-config-missing',
  message: `.cargo/mutants.toml відсутній (${file}) — запусти \`npx @7n/rules lint rust\``,
  file,
  severity: 'error'
})

/**
 * Прогоняє T0-патерни концерну над violations (як центральний fix-pipeline).
 * @param {object[]} violations порушення у формі гостя
 * @param {string} dir каталог проєкту (cwd для fix-контексту)
 * @returns {Promise<void>}
 */
async function applyT0(violations, dir) {
  const ctx = {
    cwd: dir,
    ruleId: 'test',
    concernId: 'cargo_mutants_config',
    recordWrite() {
      /* no-op у тестовому контексті */
    }
  }
  for (const p of patterns) {
    if (p.test(violations)) await p.apply(violations, ctx)
  }
}

describe('fix rust.cargo_mutants_config — T0 копіювання baseline', () => {
  test('Cargo.toml у cwd — створює cwd/.cargo/mutants.toml', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutants-flat-'))
    try {
      writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="x"\nversion="0.1.0"\n')
      await applyT0([missing('.cargo/mutants.toml')], dir)
      const target = join(dir, '.cargo', 'mutants.toml')
      expect(existsSync(target)).toBe(true)
      const content = readFileSync(target, 'utf8')
      expect(content).toContain('cargo-mutants')
      // Neutral baseline: жодних framework-specific ключів (tauri-tuning живе у tauri-rule).
      expect(content).not.toContain('additional_cargo_test_args')
      expect(content).not.toContain('exclude_globs')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('Tauri-патерн — створює app/src-tauri/.cargo/mutants.toml', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutants-tauri-'))
    try {
      mkdirSync(join(dir, 'app', 'src-tauri'), { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['app'] }))
      writeFileSync(join(dir, 'app', 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\nversion="0.1.0"\n')
      await applyT0([missing('app/src-tauri/.cargo/mutants.toml')], dir)
      expect(existsSync(join(dir, 'app', 'src-tauri', '.cargo', 'mutants.toml'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('.cargo/ існує — не псує наявні файли всередині', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutants-exists-'))
    try {
      writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="x"\nversion="0.1.0"\n')
      const cargoDir = join(dir, '.cargo')
      mkdirSync(cargoDir, { recursive: true })
      writeFileSync(join(cargoDir, 'config.toml'), '[build]\ntarget = "x86_64-unknown-linux-gnu"\n')
      await applyT0([missing('.cargo/mutants.toml')], dir)
      expect(existsSync(join(cargoDir, 'mutants.toml'))).toBe(true)
      expect(readFileSync(join(cargoDir, 'config.toml'), 'utf8')).toContain('[build]')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('mutants.toml уже існує — T0 не перезаписує', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutants-keep-'))
    try {
      writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="x"\nversion="0.1.0"\n')
      const cargoDir = join(dir, '.cargo')
      mkdirSync(cargoDir, { recursive: true })
      writeFileSync(join(cargoDir, 'mutants.toml'), '# my custom config')
      // Порожній список — саме те, що віддає гість, коли файл на місці:
      // `test()` не спрацьовує, `apply` не викликається.
      await applyT0([], dir)
      expect(readFileSync(join(cargoDir, 'mutants.toml'), 'utf8')).toBe('# my custom config')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('кілька Cargo.toml (root + Tauri + flat workspace) — створює у КОЖЕН', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mutants-multi-'))
    try {
      writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname="r"\nversion="0.1.0"\n')
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ workspaces: ['tauri-app', 'cli'] }))
      mkdirSync(join(dir, 'tauri-app', 'src-tauri'), { recursive: true })
      writeFileSync(join(dir, 'tauri-app', 'src-tauri', 'Cargo.toml'), '[package]\nname="t"\nversion="0.1.0"\n')
      mkdirSync(join(dir, 'cli'), { recursive: true })
      writeFileSync(join(dir, 'cli', 'Cargo.toml'), '[package]\nname="c"\nversion="0.1.0"\n')

      await applyT0([missing('.cargo/mutants.toml')], dir)
      expect(existsSync(join(dir, '.cargo', 'mutants.toml'))).toBe(true)
      expect(existsSync(join(dir, 'tauri-app', 'src-tauri', '.cargo', 'mutants.toml'))).toBe(true)
      expect(existsSync(join(dir, 'cli', '.cargo', 'mutants.toml'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
