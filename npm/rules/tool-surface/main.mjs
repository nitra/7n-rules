import { isRunAsCli, runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'

/**
 * Єдиний entrypoint правила (ADR 2026-06-21). `run()` — check-поверхня: applies →
 * JS-concerns → policy → mdc-refs (через runStandardRule). Lint-поверхні правило не має
 * (`meta.json` без `lint`), тож експорту `lint` тут немає.
 * Library mode: викликається CLI orchestration через `import + run(ctx)`.
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону (walkCache тощо)
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

if (isRunAsCli(import.meta.url)) {
  // Standalone: bun rules/<id>/main.mjs — повний еквівалент `npx @nitra/cursor check <id>`
  // (config-loading + whitelist + summary): library-роль (run) + standalone-роль (CLI-блок).
  process.exitCode = await runRuleCli(import.meta.dirname)
}
