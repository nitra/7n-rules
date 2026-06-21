import { isRunAsCli, runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'

/**
 * Єдиний entrypoint правила (ADR 2026-06-21). `run()` — check-поверхня: applies →
 * JS-concerns → policy → mdc-refs. `lint()` — lint-поверхня; важка реалізація лишається
 * у js/-хелпері `js/lint.mjs` (main.mjs тонкий — лише re-export).
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

export { lint } from './js/lint.mjs'

if (isRunAsCli(import.meta.url)) {
  // Standalone: bun rules/<id>/main.mjs — повний еквівалент `npx @nitra/cursor check <id>`.
  process.exitCode = await runRuleCli(import.meta.dirname)
}
