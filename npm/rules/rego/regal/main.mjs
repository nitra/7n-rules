/**
 * lint-поверхня rego/regal: read-only detector (`regal lint`). Per-file: приймає `ctx.files`
 * (конкретні `.rego`), інакше `npm/rules` (весь policy-корінь, якщо існує). Виділено з
 * колишнього bundled `rego/check` (spec
 * docs/specs/2026-07-02-text-check-per-file-split-design.md "Рішення python/php/rego") —
 * `regal lint` стилістично per-file-безпечний (не потребує сусідніх файлів).
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
 * Detector rego/regal (read-only).
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

  const regal = ensureTool('regal')
  const regalRes = runStep(regal, ['lint', ...targets], root)
  if (regalRes.status !== 0) {
    const regalSuffix = regalRes.output ? `\n${regalRes.output}` : ''
    fail(`lint-rego: regal lint — помилка (код ${regalRes.status})${regalSuffix}`, 'regal-lint-violation')
  }
  return reporter.result()
}
