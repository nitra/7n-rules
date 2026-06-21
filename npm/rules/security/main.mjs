import { spawnSync } from 'node:child_process'

import { isRunAsCli, runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'

/**
 * Єдиний entrypoint правила (ADR 2026-06-21). `run()` — check-поверхня: applies →
 * JS-concerns → policy → mdc-refs (через runStandardRule).
 * Library mode: викликається CLI orchestration через `import + run(ctx)`.
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону (walkCache тощо)
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

/**
 * `lint()` — lint-поверхня security: trufflehog filesystem скан усього репо (per-file немає).
 * Викликається lint-оркестратором за `meta.json#lint`.
 * @param {string[] | undefined} _files ігнорується (whole-repo скан)
 * @param {string} [cwd] корінь
 * @returns {Promise<number>} exit code (0 — секретів не знайдено)
 */
export function lint(_files, cwd = process.cwd()) {
  const r = spawnSync(
    'trufflehog',
    [
      'filesystem',
      '.',
      '--no-update',
      '--exclude-paths',
      '.trufflehog-exclude',
      '--results=verified,unknown',
      '--fail'
    ],
    { cwd, stdio: 'inherit' }
  )
  return Promise.resolve(typeof r.status === 'number' ? r.status : 1)
}

if (isRunAsCli(import.meta.url)) {
  // Standalone: bun rules/<id>/main.mjs — повний еквівалент `npx @nitra/cursor check <id>`
  // (config-loading + whitelist + summary): library-роль (run) + standalone-роль (CLI-блок).
  process.exitCode = await runRuleCli(import.meta.dirname)
}
