/**
 * Applies-гейт правила `python` (python.mdc): правило застосовне, лише якщо в корені є
 * `pyproject.toml`. Інакше CLI пропускає всі concerns (JS і policy) — інакше rego
 * `python/package_json` хибно вимагає `scripts.lint-python` навіть для не-Python репо.
 *
 * JS тут — гейт на наявність кореневого `pyproject.toml`. Подальші FS-перевірки
 * (`uv.lock`, `package.json`, `lint-python.yml`, заборона Poetry) — у `tooling.mjs`.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

/**
 * @param {string} [cwd] корінь репозиторію (`process.cwd()` у звичайному прогоні)
 * @returns {Promise<boolean>} `true` — правило застосовне; `false` — пропустити
 */
export function applies(cwd = process.cwd()) {
  return Promise.resolve(existsSync(join(cwd, 'pyproject.toml')))
}

/**
 * Друкує короткий context-pass — самі перевірки виконують інші concerns.
 * @returns {number} 0 — все ок (фактичні порушення повертають інші концерни)
 */
export function check() {
  const reporter = createCheckReporter()
  reporter.pass('pyproject.toml знайдено в корені — застосовую python.mdc')
  return reporter.getExitCode()
}
