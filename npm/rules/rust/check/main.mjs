/**
 * lint-поверхня rust: cargo fmt/clippy/deny.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { runStandardLint } from '../../../scripts/lib/run-standard-lint.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { generateDenyTomlLicenses } from '../../../scripts/lib/blue-oak.mjs'

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

  const denyConfigPath = join(cwd, 'deny.toml')
  if (!existsSync(denyConfigPath)) {
    if (readOnly) {
      fail(
        'lint-rust: cargo deny — немає deny.toml; запустіть `npx @nitra/cursor fix rust` локально для генерації (rust.mdc)'
      )
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
 * lint-поверхня rust.
 * @param {string[] | undefined} _files ігнорується
 * @param {string} [cwd] корінь
 * @param {{ readOnly?: boolean }} [opts]
 * @returns {Promise<number>}
 */
export function lint(_files, cwd = process.cwd(), opts = {}) {
  return runStandardLint(import.meta.dirname, () => runRustLint(cwd, opts))
}
