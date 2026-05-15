/**
 * CLI-обгортка над канонічним `lint-text` (text.mdc): послідовно
 *   1) `cspell .` — перевірка правопису з `@nitra/cspell-dict`;
 *   2) `runShellcheckText()` — авто-фікс і фінальна перевірка `*.sh` через `shellcheck`;
 *   3) `bunx markdownlint-cli2 --fix "**\/*.md" "**\/*.mdc"` — авто-фікс Markdown;
 *   4) `runV8rWithGlobs()` — schema-валідація json/json5/yaml/yml/toml через v8r з каталогом `@nitra/cursor`.
 *
 * Перший ненульовий код з ланцюжка повертається як код виходу; наступні кроки не запускаються.
 * Експортовано як `runLintTextCli` — використовується з `bin/n-cursor.js` як підкоманда `lint-text`.
 */
import { runLintStep } from '../../../scripts/utils/run-lint-step.mjs'
import { runShellcheckText } from './run-shellcheck.mjs'
import { runV8rWithGlobs } from './run-v8r.mjs'

/**
 * Виконує канонічний `lint-text`: cspell → run-shellcheck → markdownlint-cli2 → run-v8r.
 * Першу помилку повертаємо як код виходу; наступні кроки не запускаються.
 * Усі кроки синхронні (`spawnSync` + sync-ентрі з пакета), тому функція не async.
 * @returns {number} 0 — все OK, інакше — код першого кроку, що впав
 */
export function runLintTextCli() {
  const cspellCode = runLintStep('cspell', 'npx', ['cspell', '.'])
  if (cspellCode !== 0) return cspellCode

  console.log('\n▶ shellcheck (авто-фікс + фінальна перевірка *.sh)')
  const shellcheckCode = runShellcheckText()
  if (shellcheckCode !== 0) return shellcheckCode

  const markdownlintCode = runLintStep('markdownlint', 'bunx', ['markdownlint-cli2', '--fix', '**/*.md', '**/*.mdc'])
  if (markdownlintCode !== 0) return markdownlintCode

  console.log('\n▶ v8r (schema-валідація json/json5/yaml/yml/toml)')
  return runV8rWithGlobs()
}
