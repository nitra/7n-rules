import { isRunAsCli, runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'

/**
 * Правило `lint` — дім lint-оркестратора (`js/orchestrate.mjs`). Самого по собі правила
 * для перевірки немає (немає check-concern-ів/policy), тож `run` — no-op (повертає 0
 * через runStandardRule, який не знаходить жодного concern). fix.mjs обов'язковий за
 * контрактом усіх правил (`tests/fix-mjs-contract.test.mjs`).
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону
 * @returns {Promise<number>} 0 — OK
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

if (isRunAsCli(import.meta.url)) {
  process.exitCode = await runRuleCli(import.meta.dirname)
}
