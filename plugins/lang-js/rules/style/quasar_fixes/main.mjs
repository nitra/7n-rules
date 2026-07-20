/** @see ./docs/main.md */
import { readFile } from 'node:fs/promises'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { walkDir } from '@7n/rules/scripts/utils/walkDir.mjs'

const RELEVANT_RE = /\.(?:vue|scss|css)$/u

/**
 * Пари (usage у `.vue` → очікуваний CSS-фікс) з guide `quasar_fixes.mdc`. Навмисно НЕ
 * включено iOS-zoom-фікс (тригер `input`/`textarea`/`select` — занадто загальний,
 * false-positive на майже будь-якій формі; консервативно залишено лише narrative).
 */
const FIXES = [
  { usage: /<q-scroll-area\b/u, definition: /\.q-scrollarea\b/u, name: 'q-scroll-area', selector: '.q-scrollarea' },
  { usage: /<q-tooltip\b/u, definition: /\.q-tooltip\b/u, name: 'q-tooltip', selector: '.q-tooltip' }
]

/**
 * Detector style/quasar_fixes (read-only, whole-repo): якщо `.vue` використовує
 * `<q-scroll-area>` або `<q-tooltip>`, у `.scss`/`.css`/`.vue` має бути відповідний
 * CSS-фікс (guide: `quasar_fixes.mdc`). Крос-файлова перевірка usage↔definition —
 * потребує whole-repo сканування незалежно від `ctx.files`.
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

  const used = new Set()
  const defined = new Set()
  for (const file of files) {
    const content = await readFile(file, 'utf8')
    for (const fix of FIXES) {
      if (file.endsWith('.vue') && !used.has(fix.name) && fix.usage.test(content)) used.add(fix.name)
      if (!defined.has(fix.name) && fix.definition.test(content)) defined.add(fix.name)
    }
  }

  for (const fix of FIXES) {
    if (used.has(fix.name) && !defined.has(fix.name)) {
      fail(
        `Компонент \`${fix.name}\` використовується у \`.vue\`, але фікс \`${fix.selector}\` відсутній у \`.scss\`/\`.css\` (guide: style/quasar_fixes.mdc) — додай фікс до app.scss`,
        'missing-quasar-fix'
      )
    }
  }
  return reporter.result()
}
