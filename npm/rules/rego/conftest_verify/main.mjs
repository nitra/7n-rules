/**
 * lint-поверхня rego/conftest_verify: read-only detector (`conftest verify`), перейменовано з
 * колишнього bundled `rego/check` (spec docs/specs/2026-07-02-text-check-per-file-split-design.md
 * §5-A). `full`, без `lint.glob` — verify виконує rego-тести, які часто крос-package
 * (`import data.<pkg>`), тож коректний лише на всьому `npm/rules`. Не входить у delta-план
 * (§5): спрацьовує лише через `n-rules lint --full` або scoped `n-rules lint rego`.
 */
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

const LINT_TARGETS = ['npm/rules']

/**
 * Запускає один крок зовнішнього тула, повертає { status, output }.
 * @param {string} bin абсолютний шлях до бінарника
 * @param {string[]} args аргументи
 * @param {string} cwd робоча директорія
 * @returns {Promise<{ status: number, output: string }>} код завершення й обрізаний stdout+stderr
 */
async function runStep(bin, args, cwd) {
  let result
  try {
    result = await spawnAsync(bin, args, { cwd, env: process.env })
  } catch (error) {
    return { status: 1, output: `Не вдалося запустити ${bin}: ${error.message}` }
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(0, 2000)
  return { status: result.exitCode ?? 1, output }
}

/**
 * Detector rego/conftest_verify (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат зі зібраними violations
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const root = resolve(ctx.cwd)

  const targets = LINT_TARGETS.filter(rel => existsSync(resolve(root, rel)))
  if (targets.length === 0) return reporter.result()

  const conftest = resolveCmd('conftest')
  if (!conftest) return reporter.result() // conftest відсутній → пропускаємо verify (старий код повертав 0)

  const verifyRes = await runStep(conftest, ['verify', ...targets.flatMap(t => ['-p', t])], root)
  if (verifyRes.status !== 0) {
    const verifySuffix = verifyRes.output ? `\n${verifyRes.output}` : ''
    fail(`lint-rego: conftest verify — помилка (код ${verifyRes.status})${verifySuffix}`, 'conftest-verify-violation')
  }
  return reporter.result()
}
