/**
 * lint-поверхня rego: opa check + regal lint + conftest verify.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { ensureTool } from '../../../scripts/lib/ensure-tool.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { runStandardLint } from '../../../scripts/lib/run-standard-lint.mjs'

const LINT_TARGETS = ['npm/rules']

function runStep(bin, args, cwd) {
  console.log(`▶ ${bin} ${args.join(' ')}`)
  const result = spawnSync(bin, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.error) {
    process.stderr.write(`❌ Не вдалося запустити ${bin}: ${result.error.message}\n`)
    return 1
  }
  return result.status ?? 1
}

export function runLintRegoSteps(cwd = process.cwd()) {
  const root = resolve(cwd)
  const opa = ensureTool('opa')
  const regal = ensureTool('regal')

  const targets = LINT_TARGETS.filter(rel => existsSync(resolve(root, rel)))
  if (targets.length === 0) return 0

  const opaCode = runStep(opa, ['check', '--strict', ...targets], root)
  if (opaCode !== 0) return opaCode

  const regalCode = runStep(regal, ['lint', ...targets], root)
  if (regalCode !== 0) return regalCode

  const conftest = resolveCmd('conftest')
  if (!conftest) {
    console.log(
      'ℹ conftest не знайдено в PATH — пропускаю `conftest verify` (юніт-тести *_test.rego).\n' +
        '  Встанови, щоб запустити локально: brew install conftest (macOS) або https://www.conftest.dev/install/'
    )
    return 0
  }
  return runStep(conftest, ['verify', ...targets.flatMap(t => ['-p', t])], root)
}

export const runLintRego = () => runStandardLint(import.meta.dirname, () => runLintRegoSteps())

/**
 * lint-поверхня rego.
 * @param {string[] | undefined} _files ігнорується
 * @returns {Promise<number>}
 */
export function lint(_files) {
  return runLintRego()
}
