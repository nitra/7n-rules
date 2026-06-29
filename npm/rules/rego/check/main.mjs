/**
 * lint-поверхня rego: read-only detector (opa check + regal lint + conftest verify).
 * Жодних мутацій — лише запуск перевірок і збір порушень.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { ensureTool } from '../../../scripts/lib/ensure-tool.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

const LINT_TARGETS = ['npm/rules']

/**
 * Запускає один крок зовнішнього тула, повертає { status, output }.
 * @param {string} bin абсолютний шлях до бінарника
 * @param {string[]} args аргументи
 * @param {string} cwd робоча директорія
 * @returns {{ status: number, output: string }}
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
 * Detector rego/check: opa check --strict, regal lint, conftest verify (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult}
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const root = resolve(ctx.cwd)

  const targets = LINT_TARGETS.filter(rel => existsSync(resolve(root, rel)))
  if (targets.length === 0) return reporter.result()

  const opa = ensureTool('opa')
  const opaRes = runStep(opa, ['check', '--strict', ...targets], root)
  if (opaRes.status !== 0) {
    fail(`lint-rego: opa check --strict — помилка (код ${opaRes.status})${opaRes.output ? `\n${opaRes.output}` : ''}`, 'opa-check-violation')
    return reporter.result()
  }

  const regal = ensureTool('regal')
  const regalRes = runStep(regal, ['lint', ...targets], root)
  if (regalRes.status !== 0) {
    fail(`lint-rego: regal lint — помилка (код ${regalRes.status})${regalRes.output ? `\n${regalRes.output}` : ''}`, 'regal-lint-violation')
    return reporter.result()
  }

  const conftest = resolveCmd('conftest')
  if (!conftest) {
    // conftest відсутній → пропускаємо verify (старий код повертав 0)
    return reporter.result()
  }
  const verifyRes = runStep(conftest, ['verify', ...targets.flatMap(t => ['-p', t])], root)
  if (verifyRes.status !== 0) {
    fail(`lint-rego: conftest verify — помилка (код ${verifyRes.status})${verifyRes.output ? `\n${verifyRes.output}` : ''}`, 'conftest-verify-violation')
  }
  return reporter.result()
}
