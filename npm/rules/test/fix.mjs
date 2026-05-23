import { runStandardRule } from '../../scripts/utils/run-standard-rule.mjs'

/**
 * Запускає правило: applies → JS-concerns → policy → mdc-refs (через runStandardRule).
 * @param {import('../../scripts/utils/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону (walkCache тощо)
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

if (import.meta.main) {
  // eslint-disable-next-line unicorn/no-process-exit -- standalone entry-point має повертати exit-code для CI/IDE
  process.exit(await run())
}
