#!/usr/bin/env node

/**
 * CLI для перейменування розширень YAML (k8s та `.github`). Бізнес-логіка — у **`scripts/rename-yaml-extensions.mjs`**.
 *
 * Точки входу:
 * - **`npx \@nitra/cursor rename-yaml-extensions`** [опції]
 * - **`npx n-rename-yaml-extensions`** [опції] (глобальний shim з `package.json` bin)
 * - **`bun ./node_modules/\@nitra/cursor/bin/rename-yaml-extensions.mjs`**
 *
 * Опції: **`--dry-run`**, **`--root=<шлях>`** (корінь обходу; за замовчуванням **`process.cwd()`**).
 */
import { isRunAsCli } from '../scripts/cli-entry.mjs'
import { parseRenameYamlArgs, renameYamlExtensions } from '../scripts/rename-yaml-extensions.mjs'

/**
 * Запускає перейменування з виводом у консоль (для підкоманди **`n-cursor`** або прямого bin).
 * @param {string[]} argv аргументи без імені команди (усі після `rename-yaml-extensions` у **`n-cursor`**)
 * @returns {Promise<number>} **0** — успіх; **1** — були помилки (існуючий цільовий файл тощо)
 */
export async function runRenameYamlExtensionsCli(argv) {
  const { dryRun, root } = parseRenameYamlArgs(argv)
  const label = dryRun ? '[dry-run] ' : ''
  const { renamed, errors } = await renameYamlExtensions(root, { dryRun })

  for (const { relFrom, relTo } of renamed) {
    console.log(`${label}${relFrom} → ${relTo}`)
  }
  if (renamed.length === 0 && errors.length === 0) {
    console.log(`${label}Немає файлів для перейменування (k8s + .yml → .yaml; .github + .yaml → .yml).`)
  }
  for (const err of errors) {
    console.error(`  ❌ ${err}`)
  }

  return errors.length > 0 ? 1 : 0
}

if (isRunAsCli()) {
  const code = await runRenameYamlExtensionsCli(process.argv.slice(2))
  if (code !== 0) {
    process.exitCode = 1
  }
}
