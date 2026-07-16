/** @see ./docs/tooling.md */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

/**
 * Перевіряє відповідність проєкту правилам python.mdc.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями
 */
export function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  if (!existsSync(join(cwd, 'pyproject.toml'))) {
    return Promise.resolve(reporter.result())
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

  // Existence/структуру lint-python.yml вимагає провайдер-плагін @7n/rules-ci-github
  // (mixin python/lint_python_yml) — ядро провайдер-агностичне.
  return Promise.resolve(reporter.result())
}
