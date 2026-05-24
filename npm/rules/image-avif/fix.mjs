import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'

/**
 * Запускає правило: applies → JS-concerns → policy → mdc-refs (через runStandardRule).
 * Library mode: викликається CLI orchestration через `import + run(ctx)`.
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону (walkCache тощо)
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

if (import.meta.main) {
  // Standalone: bun rules/<id>/fix.mjs — повний еквівалент `npx @nitra/cursor fix <id>`
  // (config-loading + whitelist + summary). Дві ролі fix.mjs: library (run) + standalone (main).
  const { runRuleCli } = await import('../../scripts/lib/run-rule-cli.mjs')
  // eslint-disable-next-line unicorn/no-process-exit -- standalone entry-point має повертати exit-code для CI/IDE
  process.exit(await runRuleCli(import.meta.dirname))
}
