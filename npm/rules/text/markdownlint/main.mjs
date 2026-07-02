/**
 * text/markdownlint — multi-surface concern (spec docs/specs/2026-06-28-concern-lint-scope-design.md
 * §1, аналог jscpd_config/jscpd_duplicates, тут одна директорія): `policy` перевіряє, що
 * `.markdownlint-cli2.jsonc` існує; `lint` запускає сам markdownlint-cli2 по `ctx.files` (delta)
 * або по глобах .md/.mdc (full). Раніше — codegen-генерований файл лише для `policy`
 * (source-hash c64cf4a599f9bf22); після додавання `lint`-поверхні концерн переходить у ручне
 * супроводження (codegen escape-hatch: main.mjs без `@generated`-заголовка codegen не чіпає).
 */
import { main as markdownlintCli2 } from 'markdownlint-cli2'

import { evaluatePolicyConcern } from '../../../scripts/lib/lint-surface/policy-lint-adapter.mjs'

/** Glob-и markdownlint-cli2 за замовчуванням (full-режим, коли `ctx.files` не задано). */
const DEFAULT_MD_GLOBS = ['**/*.md', '**/*.mdc']

/** Розширення markdown — фільтр delta-списку файлів. */
const MD_EXT_RE = /\.mdc?$/u

/**
 * Detector text/markdownlint: policy (config existence) + lint (markdownlint-cli2), обидва
 * акумулюються в один `LintResult`.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат detector-а
 */
export async function lint(ctx) {
  const { violations } = await evaluatePolicyConcern(ctx, {
    engine: 'rego',
    policyDir: import.meta.dirname,
    files: { single: '.markdownlint-cli2.jsonc' }
  })

  const targets = ctx.files === undefined ? DEFAULT_MD_GLOBS : ctx.files.filter(f => MD_EXT_RE.test(f))
  if (targets.length === 0) return { violations }

  const code = await markdownlintCli2({
    directory: ctx.cwd,
    argv: targets,
    logMessage: () => {
      // вивід markdownlint-cli2 глушимо — detector лише повертає код
    },
    logError: () => {
      // помилки markdownlint-cli2 глушимо — detector лише повертає код
    }
  })
  if (code !== 0) {
    violations.push({
      ruleId: ctx.ruleId,
      concernId: ctx.concernId,
      reason: 'markdownlint',
      message: 'markdownlint знайшов порушення у *.md/*.mdc (text.mdc)'
    })
  }

  return { violations }
}
