/**
 * lint-поверхня rego/opa_check: read-only detector (`opa check --strict`). Per-file: приймає
 * `ctx.files` (конкретні `.rego`), інакше `npm/rules` (весь policy-корінь, якщо існує) —
 * контракт як у інших per-file detector-ів. Виділено з колишнього bundled `rego/check` (spec
 * docs/specs/2026-07-02-text-check-per-file-split-design.md "Рішення python/php/rego") —
 * `opa check` синтаксично/стилістично per-file-безпечний (не потребує сусідніх файлів).
 */
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import { ensureTool } from '../../../scripts/lib/ensure-tool.mjs'
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

/** Full-режим (ctx.files undefined): корінь policy-дерева, якщо існує. */
const FULL_TARGET = 'npm/rules'

/** Розширення `.rego` — фільтр delta-списку файлів у `lint(ctx)`. */
const REGO_EXT_RE = /\.rego$/u

/**
 * Запускає один крок зовнішнього тула, повертає { status, output }.
 * @param {string} bin абсолютний шлях до бінарника
 * @param {string[]} args аргументи
 * @param {string} cwd робоча директорія
 * @returns {{ status: number, output: string }} код завершення й обрізаний stdout+stderr
 */
function runStep(bin, args, cwd) {
  const result = spawnSync(bin, args, { cwd, encoding: 'utf8', env: process.env, shell: false })
  if (result.error) {
    return { status: 1, output: `Не вдалося запустити ${bin}: ${result.error.message}` }
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(0, 2000)
  return { status: result.status ?? 1, output }
}

/**
 * Detector rego/opa_check (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону.
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult} результат зі зібраними violations
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const root = resolve(ctx.cwd)

  const targets =
    ctx.files === undefined
      ? existsSync(resolve(root, FULL_TARGET))
        ? [FULL_TARGET]
        : []
      : ctx.files.filter(f => REGO_EXT_RE.test(f))
  if (targets.length === 0) return reporter.result()

  const opa = ensureTool('opa')
  const opaRes = runStep(opa, ['check', '--strict', ...targets], root)
  if (opaRes.status !== 0) {
    const opaSuffix = opaRes.output ? `\n${opaRes.output}` : ''
    fail(`lint-rego: opa check --strict — помилка (код ${opaRes.status})${opaSuffix}`, 'opa-check-violation')
  }
  return reporter.result()
}
