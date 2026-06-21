import { spawnSync } from 'node:child_process'

import { isRunAsCli, runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'

/**
 * Єдиний entrypoint правила (ADR 2026-06-21). `run()` — check-поверхня (applies → JS-concerns
 * → policy → mdc-refs); `lint()` — lint-поверхня (jscpd + knip, крос-файловий аналіз).
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

/**
 * lint-поверхня: jscpd (дублікати) + knip (мертвий код) по всьому репо.
 * @param {string[] | undefined} _files ігнорується (крос-файловий аналіз)
 * @param {string} [cwd] корінь репо
 * @returns {Promise<number>} 0 — OK, ≠0 — порушення
 */
export function lint(_files, cwd = process.cwd()) {
  const jscpd = spawnSync('bunx', ['jscpd', '.'], { cwd, stdio: 'inherit' })
  const jc = typeof jscpd.status === 'number' ? jscpd.status : 1
  if (jc !== 0) return Promise.resolve(jc)
  const knip = spawnSync('bunx', ['knip', '--no-config-hints'], { cwd, stdio: 'inherit' })
  return Promise.resolve(typeof knip.status === 'number' ? knip.status : 1)
}

if (isRunAsCli(import.meta.url)) {
  // Standalone: bun rules/<id>/main.mjs — повний еквівалент `npx @nitra/cursor check <id>`.
  process.exitCode = await runRuleCli(import.meta.dirname)
}
