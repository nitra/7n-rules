/**
 * Applies-гейт правила `rego` (rego.mdc): правило застосовне, лише якщо в репозиторії є
 * хоча б один `.rego`-файл (під типовими skip-ами і `.n-cursor.json:ignore`).
 *
 * Якщо `.rego` нема — CLI пропускає правило цілком (включно з polices `package_json`,
 * `vscode_extensions`, `vscode_settings`), бо вимоги rego-tooling неактуальні. Якщо є — CLI
 * прогонить policy-концерни через `target.json`-маніфести у `rules/rego/policy/<name>/`.
 *
 * JS тут лишається лише як cross-file гейт: walkDir не виразити декларативно через `target.json`.
 * Друк короткого pass-повідомлення з контекстом робить `check()` (необовʼязковий).
 */
import { createCheckReporter } from '../../../scripts/utils/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/utils/load-cursor-config.mjs'
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
 * @returns {Promise<boolean>} `true`, якщо правило застосовне
 */
export async function applies() {
  const root = process.cwd()
  const ignorePaths = await loadCursorIgnorePaths(root)
  return projectHasRegoFiles(root, ignorePaths)
}

/**
 * Друкує короткий context-pass — самі полісі прогонить CLI через `policy/<name>/target.json`.
 * @returns {number} 0 — все ок (фактичні порушення повертають policy-концерни)
 */
export function check() {
  const reporter = createCheckReporter()
  reporter.pass('Знайдено *.rego у дереві — перевіряємо канонічні конфіги rego.mdc')
  return reporter.getExitCode()
}
