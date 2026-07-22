/**
 * @see ./docs/main.md
 *
 * Read-only detector: у Tauri-проєкті (є `<ws>/src-tauri/Cargo.toml`) job
 * `.github/workflows/lint-rust.yml` повинен ставити системні залежності Linux
 * (`apt-get install` з webkit2gtk/appindicator/rsvg dev-пакетами) — інакше
 * Clippy падає на збірці `-sys`-крейтів (`webkit2gtk-sys`, `gtk-sys`, …),
 * чиї build-скрипти шукають системні `.pc`-файли через pkg-config (tauri.mdc).
 * Rustfmt нічого не компілює — вимога стосується саме Clippy-кроку.
 *
 * Текстовий (не YAML-AST) аналіз — навмисно, як `rust/toolchain_cache`:
 * мінімізує diff і зберігає коментарі при автофіксі. Існування самого
 * lint-rust.yml перевіряє `rust.lint_rust_yml` (policy required) — тут відсутній
 * файл пропускається без порушення.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { findSrcTauriDirs } from '../cargo_mutants_config/main.mjs'

/** Стабільний reason: у CI-workflow немає apt-кроку встановлення Linux-залежностей Tauri. */
export const MISSING_LINUX_DEPS_STEP = 'missing-linux-deps-step'
/** Стабільний reason: apt-крок є, але в ньому бракує канонічних пакетів. */
export const MISSING_LINUX_DEPS_PACKAGES = 'missing-linux-deps-packages'

/** Цільовий workflow-файл (канон `rust.lint_rust_yml`). */
export const LINT_RUST_YML = '.github/workflows/lint-rust.yml'

/**
 * Канонічні dev-пакети для компіляції Tauri v2 на ubuntu-runner-і:
 * webkit2gtk-4.1 (WebView), ayatana-appindicator (tray), rsvg (іконки).
 * Перевірка — підмножина: додаткові пакети в apt-рядку дозволені.
 */
export const REQUIRED_LINUX_PACKAGES = Object.freeze([
  'libwebkit2gtk-4.1-dev',
  'libayatana-appindicator3-dev',
  'librsvg2-dev'
])

const APT_INSTALL_RE = /\bapt-get install\b/u

/**
 * Результат текстового сканування lint-rust.yml на apt-крок системних залежностей.
 * @typedef {object} LinuxDepsScan
 * @property {number} aptLine індекс першого рядка з `apt-get install` (−1, якщо немає)
 * @property {string[]} missing канонічні пакети, відсутні у вмісті файла
 */

/**
 * Сканує вміст workflow: перший `apt-get install`-рядок і перелік канонічних
 * пакетів, яких немає ніде у файлі (substring — пакет може стояти на
 * continuation-рядку багаторядкового `run: |`).
 * @param {string} content вміст workflow-файла
 * @returns {LinuxDepsScan} результат сканування
 */
export function scanLinuxDeps(content) {
  const lines = content.split('\n')
  const aptLine = lines.findIndex(l => APT_INSTALL_RE.test(l))
  const missing = REQUIRED_LINUX_PACKAGES.filter(p => !content.includes(p))
  return { aptLine, missing }
}

/**
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінт-прогону
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)

  const srcTauriDirs = await findSrcTauriDirs(cwd)
  if (srcTauriDirs.length === 0) return reporter.result()

  const abs = join(cwd, LINT_RUST_YML)
  if (!existsSync(abs)) return reporter.result() // існування файла — rust.lint_rust_yml

  const content = await readFile(abs, 'utf8')
  const { aptLine, missing } = scanLinuxDeps(content)

  if (aptLine === -1) {
    reporter.fail(
      `${LINT_RUST_YML}: Tauri-проєкт потребує кроку системних залежностей Linux (apt-get install ${REQUIRED_LINUX_PACKAGES.join(' ')}) перед Clippy (tauri.mdc)`,
      { reason: MISSING_LINUX_DEPS_STEP, file: LINT_RUST_YML, data: { kind: MISSING_LINUX_DEPS_STEP } }
    )
    return reporter.result()
  }

  if (missing.length > 0) {
    reporter.fail(`${LINT_RUST_YML}: apt-крок без канонічних Tauri-пакетів [${missing.join(', ')}] (tauri.mdc)`, {
      reason: MISSING_LINUX_DEPS_PACKAGES,
      file: LINT_RUST_YML,
      data: { kind: MISSING_LINUX_DEPS_PACKAGES, missing }
    })
    return reporter.result()
  }

  reporter.pass(`${LINT_RUST_YML}: системні залежності Tauri (Linux) присутні`)
  return reporter.result()
}
