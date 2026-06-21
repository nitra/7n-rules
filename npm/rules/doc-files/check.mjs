import { isRunAsCli, runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'

/**
 * Запускає правило doc-files: applies → JS-concerns → policy → mdc-refs (через runStandardRule).
 * Структурні concerns (наявність workflow lint-doc-files.yml, скрипт у package.json) закриває
 * policy-канал; контентні порушення (відсутні/застарілі доки) — поза `n-cursor fix`, їх закриває
 * `fix-doc-files` (генерація). Library mode: викликається через `import + run(ctx)`.
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

if (isRunAsCli(import.meta.url)) {
  // Standalone: bun rules/doc-files/check.mjs — еквівалент `npx @nitra/cursor check doc-files`.
  process.exitCode = await runRuleCli(import.meta.dirname)
}
