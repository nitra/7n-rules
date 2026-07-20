/** @see ./docs/main.md */
import { readFile } from 'node:fs/promises'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { walkDir } from '@7n/rules/scripts/utils/walkDir.mjs'

const RELEVANT_RE = /\.(?:vue|scss|css)$/u
const USAGE_RE = /\bn-admin-table\b/u
const DEFINITION_RE = /\.n-admin-table\b/u

/**
 * Detector style/admin_table (read-only, whole-repo): якщо десь у `.vue` використано
 * клас `n-admin-table`, він має бути визначений хоч в одному `.scss`/`.css`/`.vue`
 * (guide: `admin_table.mdc`). Для усунення false positives — крос-файлова перевірка,
 * тож потребує whole-repo сканування незалежно від `ctx.files`.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону (cwd)
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат зі зібраними violations
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const cwd = ctx.cwd

  /** @type {string[]} */
  const files = []
  await walkDir(cwd, f => {
    if (RELEVANT_RE.test(f)) files.push(f)
  })

  let used = false
  let defined = false
  for (const file of files) {
    const content = await readFile(file, 'utf8')
    if (!used && file.endsWith('.vue') && USAGE_RE.test(content)) used = true
    if (!defined && DEFINITION_RE.test(content)) defined = true
    if (used && defined) break
  }

  if (used && !defined) {
    fail(
      'Клас `.n-admin-table` використовується у `.vue`, але не визначений у жодному `.scss`/`.css` (guide: style/admin_table.mdc) — додай фікс до app.scss',
      'missing-admin-table-style'
    )
  }
  return reporter.result()
}
