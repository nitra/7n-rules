/**
 * lint-поверхня style: read-only detector (stylelint без --fix) для css/scss/vue.
 * Per-file (ctx.files) або весь проєкт (ctx.files === undefined). Якщо stylelint
 * недоступний — крок пропускається (без npx-автовстановлення).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'

const STYLE_EXT_RE = /\.(?:css|scss|vue)$/u

/**
 * @param {string[]} files список шляхів
 * @returns {string[]} лише css/scss/vue
 */
export function filterStyleFiles(files) {
  return files.filter(f => STYLE_EXT_RE.test(f))
}

/**
 * Резолвить бінарник stylelint: спершу локальний node_modules/.bin, потім PATH.
 * @param {string} cwd корінь
 * @returns {string | null} абсолютний шлях або null
 */
function resolveStylelint(cwd) {
  const local = join(cwd, 'node_modules', '.bin', 'stylelint')
  if (existsSync(local)) return local
  return resolveCmd('stylelint')
}

/**
 * Detector style/lint (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult}
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const cwd = ctx.cwd
  const files = ctx.files

  /** @type {string[]} */
  const targets = []
  if (files === undefined) {
    targets.push('**/*.{css,scss,vue}')
  } else {
    const style = filterStyleFiles(files)
    if (style.length === 0) return reporter.result()
    targets.push(...style)
  }

  const stylelint = resolveStylelint(cwd)
  if (!stylelint) {
    // stylelint недоступний → крок пропущено (без автовстановлення)
    return reporter.result()
  }

  const r = spawnSync(stylelint, targets, { cwd, encoding: 'utf8', shell: false })
  if (r.status !== 0) {
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
    fail(`lint-style: stylelint — порушення (код ${r.status ?? 1}, style.mdc)${out ? `\n${out}` : ''}`, 'stylelint-violation')
  }
  return reporter.result()
}
