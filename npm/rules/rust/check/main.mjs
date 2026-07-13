/**
 * lint-поверхня rust: read-only detector (cargo fmt --check + clippy -D warnings +
 * cargo deny check licenses). Генерація deny.toml — окремий T0-fix, не в detector-і.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'

/**
 * @param {string} label назва кроку.
 * @param {string} cargo шлях до бінарника cargo.
 * @param {string[]} args аргументи cargo.
 * @param {string} cwd робочий каталог.
 * @param {(msg: string, reason: string) => void} fail колбек реєстрації порушення.
 * @param {string} reason машиночитна причина порушення.
 * @returns {boolean} true якщо OK
 */
function runCargo(label, cargo, args, cwd, fail, reason) {
  const r = spawnSync(cargo, args, { cwd, encoding: 'utf8', shell: false })
  if (r.status === 0) return true
  const code = typeof r.status === 'number' ? r.status : 1
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
  const outTail = out ? `\n${out}` : ''
  fail(`lint-rust: ${label} — помилка (код ${code}, rust.mdc)${outTail}`, reason)
  return false
}

/**
 * Detector rust/check (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult} результат із порушеннями
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const cwd = ctx.cwd

  if (!existsSync(join(cwd, 'Cargo.toml'))) {
    // немає Cargo.toml → кроки Rust пропущено
    return reporter.result()
  }

  const cargo = resolveCmd('cargo')
  if (!cargo) {
    fail('lint-rust: `cargo` не знайдено в PATH (Rust toolchain через rustup, rust.mdc)', 'cargo-missing')
    return reporter.result()
  }

  if (!runCargo('cargo fmt --check', cargo, ['fmt', '--all', '--', '--check'], cwd, fail, 'cargo-fmt-violation')) {
    return reporter.result()
  }

  runCargo(
    'cargo clippy -D warnings',
    cargo,
    ['clippy', '--all-targets', '--all-features', '--', '-D', 'warnings'],
    cwd,
    fail,
    'cargo-clippy-violation'
  )

  const denyConfigPath = join(cwd, 'deny.toml')
  if (!existsSync(denyConfigPath)) {
    fail(
      'lint-rust: cargo deny — немає deny.toml; запустіть `npx @7n/rules fix rust` локально для генерації (rust.mdc)',
      'deny-config-missing'
    )
    return reporter.result()
  }

  const hasDeny = spawnSync(cargo, ['deny', '--version'], { stdio: 'ignore', shell: false }).status === 0
  if (hasDeny) {
    runCargo('cargo deny check licenses', cargo, ['deny', 'check', 'licenses'], cwd, fail, 'cargo-deny-violation')
  }
  // cargo-deny не встановлено → перевірку ліцензій пропущено (старий код — pass)

  return reporter.result()
}
