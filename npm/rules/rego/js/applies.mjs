/** @see ./docs/applies.md */
import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

/**
 * Чи є хоча б один `.rego`-файл у дереві від `cwd`. Зупиняється на першому матчі.
 * @param {string} root абсолютний шлях кореня
 * @param {string[]} ignorePaths шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<boolean>} `true`, якщо знайдено хоч один `.rego`
 */
async function projectHasRegoFiles(root, ignorePaths) {
  let found = false
  await walkDir(
    root,
    p => {
      if (p.endsWith('.rego')) {
        found = true
      }
    },
    ignorePaths
  )
  return found
}

/**
 * Rule-level applies-гейт: CLI пропускає правило, якщо в репо немає `.rego` файлів.
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<boolean>} `true`, якщо правило застосовне
 */
export async function applies(cwd = process.cwd()) {
  const ignorePaths = await loadCursorIgnorePaths(cwd)
  return projectHasRegoFiles(cwd, ignorePaths)
}

/**
 * Друкує короткий context-pass — самі полісі прогонить CLI через `policy/<name>/target.json`.
 * @returns {number} 0 — все ок (фактичні порушення повертають policy-концерни)
 */
export function main() {
  const reporter = createCheckReporter()
  reporter.pass('Знайдено *.rego у дереві — перевіряємо канонічні конфіги rego.mdc')
  return reporter.getExitCode()
}
