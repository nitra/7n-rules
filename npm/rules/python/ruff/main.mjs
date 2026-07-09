/**
 * lint-поверхня python/ruff: read-only detector (`ruff check` + `ruff format --check`, через
 * `uv run --frozen`). Per-file: приймає `ctx.files`, інакше `.` (весь проєкт). Виділено з
 * колишнього bundled `python/check` (spec docs/specs/2026-07-02-text-check-per-file-split-design.md
 * "Рішення python/php/rego") — ruff сам транзитивно підвантажує імпортовані модулі
 * (follow-imports), тож коректний і на підмножині переданих файлів.
 */
import { spawnSync } from 'node:child_process'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { preparePythonRun } from '../lib/uv-run.mjs'

/**
 * @param {string} label назва кроку.
 * @param {string} uv шлях до бінарника uv.
 * @param {string[]} args аргументи ruff (без `uv run --frozen ruff`-префіксу).
 * @param {string} cwd робочий каталог.
 * @param {(msg: string, opts: object) => void} fail колбек реєстрації порушення.
 * @param {string} reason машиночитна причина порушення.
 * @returns {boolean} true якщо OK
 */
function runRuffStep(label, uv, args, cwd, fail, reason) {
  const r = spawnSync(uv, ['run', '--frozen', 'ruff', ...args], { cwd, encoding: 'utf8', shell: false })
  if (r.status === 0) return true
  const code = typeof r.status === 'number' ? r.status : 1
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
  const outSuffix = out ? `\n${out}` : ''
  fail(`lint-python: ${label} — помилка (код ${code}, python.mdc)${outSuffix}`, reason)
  return false
}

/**
 * Detector python/ruff (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult} результат із порушеннями
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const cwd = ctx.cwd

  const prepared = preparePythonRun(ctx, fail, 'ruff')
  if (!prepared) return reporter.result()
  const { uv, targets } = prepared

  if (!runRuffStep('ruff check', uv, ['check', ...targets], cwd, fail, 'ruff-check-violation')) {
    return reporter.result()
  }
  runRuffStep('ruff format --check', uv, ['format', '--check', ...targets], cwd, fail, 'ruff-format-violation')

  return reporter.result()
}
