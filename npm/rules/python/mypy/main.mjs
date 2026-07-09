/**
 * lint-поверхня python/mypy: read-only detector (`mypy`, через `uv run --frozen`). Per-file:
 * приймає `ctx.files`, інакше `.` (весь проєкт). Виділено з колишнього bundled `python/check`
 * (spec docs/specs/2026-07-02-text-check-per-file-split-design.md "Рішення python/php/rego") —
 * mypy сам транзитивно підвантажує імпортовані модулі (follow-imports), тож дає коректні
 * діагнози й на підмножині переданих файлів. Немає fix capability (mypy — detect-only).
 */
import { spawnSync } from 'node:child_process'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { preparePythonRun } from '../lib/uv-run.mjs'

/**
 * Detector python/mypy (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult} результат із порушеннями
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const cwd = ctx.cwd

  const prepared = preparePythonRun(ctx, fail, 'mypy')
  if (!prepared) return reporter.result()
  const { uv, targets } = prepared

  const r = spawnSync(uv, ['run', '--frozen', 'mypy', ...targets], { cwd, encoding: 'utf8', shell: false })
  if (r.status !== 0) {
    const code = typeof r.status === 'number' ? r.status : 1
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
    const outSuffix = out ? `\n${out}` : ''
    fail(`lint-python: mypy — помилка (код ${code}, python.mdc)${outSuffix}`, 'mypy-violation')
  }

  return reporter.result()
}
