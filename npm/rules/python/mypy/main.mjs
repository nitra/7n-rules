/**
 * lint-поверхня python/mypy: read-only detector (`mypy`, через `uv run --frozen`). Per-file:
 * приймає `ctx.files`, інакше `.` (весь проєкт). Виділено з колишнього bundled `python/check`
 * (spec docs/specs/2026-07-02-text-check-per-file-split-design.md "Рішення python/php/rego") —
 * mypy сам транзитивно підвантажує імпортовані модулі (follow-imports), тож дає коректні
 * діагнози й на підмножині переданих файлів. Немає fix capability (mypy — detect-only).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'

/** Розширення `.py` — фільтр delta-списку файлів у `lint(ctx)`. */
const PY_EXT_RE = /\.py$/u

/**
 * @param {string} uv шлях до бінарника uv.
 * @param {string} tool ім'я інструменту в uv-середовищі.
 * @returns {boolean} true якщо інструмент доступний
 */
function uvToolAvailable(uv, tool) {
  const r = spawnSync(uv, ['run', '--frozen', tool, '--version'], { stdio: 'ignore', shell: false })
  return r.status === 0
}

/**
 * Detector python/mypy (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult} результат із порушеннями
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const cwd = ctx.cwd

  if (!existsSync(join(cwd, 'pyproject.toml'))) return reporter.result()

  const targets = ctx.files === undefined ? ['.'] : ctx.files.filter(f => PY_EXT_RE.test(f))
  if (targets.length === 0) return reporter.result()

  const uv = resolveCmd('uv')
  if (!uv) {
    fail('lint-python: `uv` не знайдено в PATH (потрібен при наявному pyproject.toml, python.mdc)', 'uv-missing')
    return reporter.result()
  }
  if (!uvToolAvailable(uv, 'mypy')) return reporter.result() // mypy недоступний у uv-середовищі → пропущено

  const r = spawnSync(uv, ['run', '--frozen', 'mypy', ...targets], { cwd, encoding: 'utf8', shell: false })
  if (r.status !== 0) {
    const code = typeof r.status === 'number' ? r.status : 1
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
    const outSuffix = out ? `\n${out}` : ''
    fail(`lint-python: mypy — помилка (код ${code}, python.mdc)${outSuffix}`, 'mypy-violation')
  }

  return reporter.result()
}
