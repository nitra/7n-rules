/** @see ./docs/lint.md */
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createCheckReporter } from '../../scripts/lib/check-reporter.mjs'
import { runStandardLint } from '../../scripts/lib/run-standard-lint.mjs'
import { resolveCmd } from '../../scripts/utils/resolve-cmd.mjs'
import { isRunAsCli, runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'
import { generateDenyTomlLicenses } from '../../scripts/lib/blue-oak.mjs'

/**
 * Єдиний entrypoint правила (ADR 2026-06-21). `run()` — check-поверхня (applies → JS-concerns
 * → policy → mdc-refs); `lint()` нижче — lint-поверхня (cargo fmt/clippy), імпл інлайн тут.
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

/**
 * Запускає cargo-крок і репортить результат.
 * @param {string} label назва кроку
 * @param {string} cargo абсолютний шлях до `cargo`
 * @param {string[]} args аргументи
 * @param {(m: string) => void} pass callback pass
 * @param {(m: string) => void} fail callback fail
 * @returns {boolean} true якщо крок успішний
 */
function runCargo(label, cargo, args, pass, fail) {
  const r = spawnSync(cargo, args, { stdio: 'inherit', shell: false })
  if (r.status === 0) {
    pass(`lint-rust: ${label} — OK`)
    return true
  }
  const code = typeof r.status === 'number' ? r.status : 1
  fail(`lint-rust: ${label} — помилка (код ${code}, rust.mdc)`)
  return false
}

/**
 * Оркестраторний адаптер `n-cursor lint rust`: rustfmt + clippy через cargo. Без `Cargo.toml` —
 * no-op (0). `cargo`/`rustfmt`/`clippy` — Rust toolchain (rustup), не npm-залежності.
 * readOnly (CI): `cargo fmt --all -- --check` + `cargo clippy … -D warnings` (нуль мутацій).
 * fix: `cargo fmt --all` + `cargo clippy --fix` + фінальний `cargo clippy … -D warnings`.
 * @param {string[] | undefined} _files ігнорується (cargo обходить crate сам)
 * @param {string} [cwd] корінь
 * @param {{ readOnly?: boolean }} [opts] readOnly → без мутацій
 * @returns {number} exit code
 */
function runRustLint(cwd = process.cwd(), opts = {}) {
  const readOnly = opts.readOnly === true
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  if (!existsSync(join(cwd, 'Cargo.toml'))) {
    pass('lint-rust: немає Cargo.toml — кроки Rust пропущено')
    return reporter.getExitCode()
  }

  const cargo = resolveCmd('cargo')
  if (!cargo) {
    fail('lint-rust: `cargo` не знайдено в PATH (Rust toolchain через rustup, rust.mdc)')
    return reporter.getExitCode()
  }

  const fmtArgs = readOnly ? ['fmt', '--all', '--', '--check'] : ['fmt', '--all']
  if (!runCargo(readOnly ? 'cargo fmt --check' : 'cargo fmt', cargo, fmtArgs, pass, fail)) {
    return reporter.getExitCode()
  }

  if (!readOnly) {
    const fixArgs = ['clippy', '--fix', '--allow-staged', '--allow-dirty', '--all-targets', '--all-features']
    if (!runCargo('cargo clippy --fix', cargo, fixArgs, pass, fail)) return reporter.getExitCode()
  }

  runCargo(
    'cargo clippy -D warnings',
    cargo,
    ['clippy', '--all-targets', '--all-features', '--', '-D', 'warnings'],
    pass,
    fail
  )

  // cargo deny check licenses: fix-режим — auto-генерує deny.toml якщо відсутній;
  // readOnly (CI) — відсутність файлу → fail.
  const denyConfigPath = join(cwd, 'deny.toml')
  if (!existsSync(denyConfigPath)) {
    if (readOnly) {
      fail('lint-rust: cargo deny — немає deny.toml; запустіть `npx @nitra/cursor fix rust` локально для генерації (rust.mdc)')
    } else {
      writeFileSync(denyConfigPath, generateDenyTomlLicenses(), 'utf8')
      pass('lint-rust: cargo deny — створено deny.toml з дефолтним allowlist')
    }
  }
  if (existsSync(denyConfigPath)) {
    const hasDeny = spawnSync(cargo, ['deny', '--version'], { stdio: 'ignore', shell: false }).status === 0
    if (hasDeny) {
      runCargo('cargo deny check licenses', cargo, ['deny', 'check', 'licenses'], pass, fail)
    } else {
      pass('lint-rust: cargo deny — не встановлений (cargo install cargo-deny), перевірку ліцензій пропущено')
    }
  }

  return reporter.getExitCode()
}

/**
 * Locked orchestration entry point for `n-cursor lint rust`.
 * @param {string[] | undefined} _files ігнорується (cargo обходить crate сам)
 * @param {string} [cwd] корінь
 * @param {{ readOnly?: boolean }} [opts] readOnly → без мутацій
 * @returns {Promise<number>} exit code
 */
export function lint(_files, cwd = process.cwd(), opts = {}) {
  return runStandardLint(import.meta.dirname, () => runRustLint(cwd, opts))
}

if (isRunAsCli(import.meta.url)) {
  // Standalone: bun rules/rust/main.mjs — повний еквівалент `npx @nitra/cursor check rust`.
  process.exitCode = await runRuleCli(import.meta.dirname)
}
