/** @see ./docs/main.md */
import { readFile } from 'node:fs/promises'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { walkDir } from '@7n/rules/scripts/utils/walkDir.mjs'

const RELEVANT_RE = /\.(?:vue|scss|css)$/u
const USAGE_RE = /\bn-gap-(xs|sm|md|lg)\b/gu
const DEFINITION_RE = /\.n-gap-(xs|sm|md|lg)\b/gu

/**
 * Detector style/gap (read-only, whole-repo): кожен суфікс `.n-gap-{xs,sm,md,lg}`,
 * використаний у `.vue`, має бути визначений хоч в одному `.scss`/`.css`/`.vue`
 * (guide: `gap.mdc`). Крос-файлова перевірка usage↔definition — потребує whole-repo
 * сканування незалежно від `ctx.files`.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону (cwd)
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат зі зібраними violations
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

  /** @type {Set<string>} */
  const used = new Set()
  /** @type {Set<string>} */
  const defined = new Set()
  for (const file of files) {
    const content = await readFile(file, 'utf8')
    if (file.endsWith('.vue')) {
      for (const m of content.matchAll(USAGE_RE)) used.add(m[1])
    }
    for (const m of content.matchAll(DEFINITION_RE)) defined.add(m[1])
  }

  for (const suffix of used) {
    if (!defined.has(suffix)) {
      fail(
        `Клас \`.n-gap-${suffix}\` використовується у \`.vue\`, але не визначений у жодному \`.scss\`/\`.css\` (guide: style/gap.mdc) — додай клас до app.scss`,
        'missing-gap-style'
      )
    }
  }
  return reporter.result()
}
