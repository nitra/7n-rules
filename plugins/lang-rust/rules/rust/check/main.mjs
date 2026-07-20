/**
 * lint-поверхня rust: read-only detector (cargo fmt --check + clippy -D warnings +
 * cargo deny check licenses). Генерація deny.toml — окремий T0-fix, не в detector-і.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '@7n/rules/scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '@7n/rules/scripts/utils/spawn-async.mjs'

/**
 * Async (не блокує event loop) — детектор може виконуватись у parallel lane `detectAll()`
 * (ADR 260716-1354).
 * @param {string} label назва кроку.
 * @param {string} cargo шлях до бінарника cargo.
 * @param {string[]} args аргументи cargo.
 * @param {string} cwd робочий каталог.
 * @param {(msg: string, reason: string) => void} fail колбек реєстрації порушення.
 * @param {string} reason машиночитна причина порушення.
 * @returns {Promise<boolean>} true якщо OK
 */
async function runCargo(label, cargo, args, cwd, fail, reason) {
  const r = await spawnAsync(cargo, args, { cwd })
  if (r.exitCode === 0) return true
  const code = typeof r.exitCode === 'number' ? r.exitCode : 1
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
  const outTail = out ? `\n${out}` : ''
  fail(`lint-rust: ${label} — помилка (код ${code}, rust.mdc)${outTail}`, reason)
  return false
}

/**
 * Detector rust/check (read-only). Async (не блокує event loop) — детектор може виконуватись
 * у parallel lane `detectAll()` (ADR 260716-1354).
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями
 */
export async function lint(ctx) {
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

  if (
    !(await runCargo('cargo fmt --check', cargo, ['fmt', '--all', '--', '--check'], cwd, fail, 'cargo-fmt-violation'))
  ) {
    return reporter.result()
  }

  await runCargo(
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

  const denyVersionResult = await spawnAsync(cargo, ['deny', '--version'])
  const hasDeny = denyVersionResult.exitCode === 0
  if (hasDeny) {
    await runCargo('cargo deny check licenses', cargo, ['deny', 'check', 'licenses'], cwd, fail, 'cargo-deny-violation')
  }
  // cargo-deny не встановлено → перевірку ліцензій пропущено (старий код — pass)

  return reporter.result()
}
