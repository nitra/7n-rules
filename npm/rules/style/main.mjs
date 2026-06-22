import { spawnSync } from 'node:child_process'

import { isRunAsCli, runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'

const STYLE_EXT_RE = /\.(?:css|scss|vue)$/u

/**
 * Єдиний entrypoint правила (ADR 2026-06-21). `run()` — check-поверхня (applies → JS-concerns
 * → policy → mdc-refs); `lint()` — lint-поверхня (stylelint по css/scss/vue), імпл інлайн тут.
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

/**
 * @param {string[]} files список шляхів
 * @returns {string[]} лише css/scss/vue
 */
export function filterStyleFiles(files) {
  return files.filter(f => STYLE_EXT_RE.test(f))
}

/**
 * lint-поверхня: stylelint (per-file для css/scss/vue або весь проєкт у `--full`).
 * @param {string[] | undefined} files per-file: ці файли; undefined: весь проєкт (--full)
 * @param {string} [cwd] корінь
 * @param {{ readOnly?: boolean }} [opts] readOnly → без `--fix` (детект, нуль мутацій)
 * @returns {Promise<number>} exit code
 */
export function lint(files, cwd = process.cwd(), opts = {}) {
  const args = opts.readOnly === true ? ['stylelint'] : ['stylelint', '--fix']
  if (files === undefined) {
    args.push('**/*.{css,scss,vue}')
  } else {
    const style = filterStyleFiles(files)
    if (style.length === 0) return Promise.resolve(0)
    args.push(...style)
  }
  const r = spawnSync('npx', args, { cwd, stdio: 'inherit' })
  return Promise.resolve(typeof r.status === 'number' ? r.status : 1)
}

if (isRunAsCli(import.meta.url)) {
  // Standalone: bun rules/<id>/main.mjs — повний еквівалент `npx @nitra/cursor check <id>`.
  process.exitCode = await runRuleCli(import.meta.dirname)
}
