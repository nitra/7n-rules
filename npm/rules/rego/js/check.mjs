/**
 * Перевіряє інструментарій rego (rego.mdc): VSCode та `package.json` для проєктів,
 * які мають хоча б один `.rego` файл у дереві.
 *
 * Cross-file gating (JS):
 *   1. Walk дерева від `cwd` (з типовими skip-ами і `.n-cursor.json:ignore`).
 *   2. Якщо немає жодного `.rego` — пропустити перевірку (rego-tooling не вимагається).
 *   3. Інакше — для кожного канонічного файла:
 *      - FS-existence (з повідомленням, якщо відсутній);
 *      - делегувати content-валідацію rego-пакетам через `runConftestBatch`:
 *        `rego.vscode_extensions` — `.vscode/extensions.json`: `tsandall.opa`
 *          у `recommendations`;
 *        `rego.vscode_settings` — `.vscode/settings.json`: `[rego]` з
 *          `editor.defaultFormatter: "tsandall.opa"` і `editor.formatOnSave: true`;
 *        `rego.package_json` — `package.json#scripts.lint-rego` має бути
 *          канонічним `"bun ./npm/scripts/lint-rego.mjs"`.
 *
 * Rego-полісі глобально у `lint-conftest` НЕ реєструються — це conditional
 * правило (без `.rego` файлів вимоги не діють). Plan B: Rego-authoritative +
 * JS-orchestrator з `runConftestBatch`.
 *
 * `bun run lint-rego` (`npm/scripts/lint-rego.mjs`) — окрема перевірка САМИХ
 * rego-полісі (opa check / regal lint / conftest verify), не плутати з цим
 * скриптом, який перевіряє ПРОЄКТНЕ оточення для роботи з rego.
 */
import { existsSync } from 'node:fs'

import { createCheckReporter } from '../../../scripts/utils/check-reporter.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/utils/load-cursor-config.mjs'
import { runConftestBatch } from '../../../scripts/utils/run-conftest-batch.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

/** Список (path, namespace, policyDirRel) для трьох канонічних конфігів rego.mdc. */
const REGO_TARGETS = [
  ['.vscode/extensions.json', 'rego.vscode_extensions', 'rego/vscode_extensions'],
  ['.vscode/settings.json', 'rego.vscode_settings', 'rego/vscode_settings'],
  ['package.json', 'rego.package_json', 'rego/package_json']
]

/**
 * Чи є хоча б один `.rego` файл у дереві від `cwd`.
 * @param {string} root абсолютний шлях кореня
 * @param {string[]} ignorePaths шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<boolean>} `true`, якщо знайдено хоча б один `.rego`
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
 * Делегує content-валідацію одного канонічного конфіга rego-пакету через
 * `runConftestBatch`. FS-існування — попередньо перевірено.
 * @param {string} path відносний шлях до файлу
 * @param {string} namespace rego-пакет (наприклад `rego.vscode_extensions`)
 * @param {string} policyDirRel піддиректорія у `npm/policy/`
 * @param {(msg: string) => void} pass success-репортер
 * @param {(msg: string) => void} fail fail-репортер
 * @returns {void}
 */
function runRegoPolicyOnPath(path, namespace, policyDirRel, pass, fail) {
  const violations = runConftestBatch({ policyDirRel, namespace, files: [path] })
  if (violations.length === 0) {
    pass(`${path} відповідає ${namespace} (rego)`)
    return
  }
  for (const v of violations) fail(v.message)
}

/**
 * Перевіряє відповідність проєкту правилам rego.mdc.
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const root = process.cwd()
  const ignorePaths = await loadCursorIgnorePaths(root)
  const hasRego = await projectHasRegoFiles(root, ignorePaths)
  if (!hasRego) {
    pass('Немає *.rego у дереві — rego-tooling не вимагається (rego.mdc)')
    return reporter.getExitCode()
  }

  pass('Знайдено *.rego у дереві — перевіряємо канонічні конфіги rego.mdc')

  for (const [path, namespace, policyDirRel] of REGO_TARGETS) {
    if (!existsSync(path)) {
      fail(`${path} не існує — створи згідно rego.mdc (${namespace})`)
      continue
    }
    runRegoPolicyOnPath(path, namespace, policyDirRel, pass, fail)
  }

  return reporter.getExitCode()
}
