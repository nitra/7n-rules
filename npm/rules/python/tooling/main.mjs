/** @see ./docs/tooling.md */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

/**
 * Перевіряє відповідність проєкту правилам python.mdc.
 * @param {string} [cwd] корінь репозиторію (`process.cwd()` у звичайному прогоні)
 * @returns {number} 0 — все OK, 1 — є проблеми
 */
export function main(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  if (!existsSync(join(cwd, 'pyproject.toml'))) {
    return reporter.getExitCode()
  }

  if (existsSync(join(cwd, 'uv.lock'))) {
    pass('uv.lock є')
  } else {
    fail('uv.lock не знайдено — згенеруй `uv lock` (python.mdc, без Poetry)')
  }

  // Poetry-артефакти заборонені: uv є єдиним пакет-менеджером (python.mdc).
  for (const poetryFile of ['poetry.lock', 'poetry.toml']) {
    if (existsSync(join(cwd, poetryFile))) {
      fail(`${poetryFile} знайдено — прибери Poetry, мігруй на uv (python.mdc)`)
    } else {
      pass(`${poetryFile} відсутній`)
    }
  }

  if (existsSync(join(cwd, 'package.json'))) {
    pass('package.json є')
  } else {
    fail('package.json не знайдено в корені — додай (python.mdc)')
  }

  const wfPath = '.github/workflows/lint-python.yml'
  if (existsSync(join(cwd, wfPath))) {
    pass(`${wfPath} є (структуру перевіряє fix → python.lint_python_yml)`)
  } else {
    fail(`${wfPath} не існує — створи згідно python.mdc`)
  }

  return reporter.getExitCode()
}
