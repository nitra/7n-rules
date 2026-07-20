/**
 * lint-поверхня style: read-only detector (stylelint без --fix) для css/scss/vue.
 * Per-file (ctx.files) або весь проєкт (ctx.files === undefined). `stylelint` —
 * задекларована залежність плагіна (справжній `npm install` завжди його ставить);
 * якщо резолв все ж не вдався (побитий install, hoisting-аномалія) — крок
 * пропускається з видимим warn-diagnostic, а не мовчки (без npx-автовстановлення).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '@7n/rules/scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '@7n/rules/scripts/utils/spawn-async.mjs'

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
export function resolveStylelint(cwd) {
  const local = join(cwd, 'node_modules', '.bin', 'stylelint')
  if (existsSync(local)) return local
  return resolveCmd('stylelint')
}

/**
 * Detector style/lint (read-only).
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону (cwd, files)
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат зі зібраними violations
 */
export async function lint(ctx) {
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
    // stylelint — задекларована залежність плагіна, тож відсутність тут аномальна
    // (побитий install, hoisting) — крок пропущено з видимим warn, не мовчки.
    const result = reporter.result()
    result.diagnostics = [
      {
        level: 'warn',
        message:
          'lint-style: `stylelint` не резолвиться (ні node_modules/.bin, ні PATH) — CSS/SCSS/Vue-стилі НЕ перевірені ' +
          'цим прогоном (style.mdc). `stylelint` — залежність @7n/rules-lang-js; переустанови плагін, якщо бачиш це.'
      }
    ]
    return result
  }

  const r = await spawnAsync(stylelint, targets, { cwd, shell: false })
  if (r.exitCode !== 0) {
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
    const outSuffix = out ? `\n${out}` : ''
    fail(`lint-style: stylelint — порушення (код ${r.exitCode ?? 1}, style.mdc)${outSuffix}`, 'stylelint-violation')
  }
  return reporter.result()
}
