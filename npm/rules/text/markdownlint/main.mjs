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

  // logError отримує один готовий рядок на порушення через default output formatter
  // markdownlint-cli2 ("<file>:<line>:<col> <rule> <опис> [<деталь>]") — раніше глушився,
  // detector повертав лише голе "щось не пройшло" без файлу/правила/причини, тож LLM
  // fix-worker (як і non-verbose підсумок) не мав інформації, що саме виправляти
  // (той самий патерн, що й text/run-v8r до фіксу). logMessage лишається no-op —
  // banner/Finding/Found/Linting/Summary прогрес-текст, не деталь порушення.
  const errorLines = []
  const code = await markdownlintCli2({
    directory: ctx.cwd,
    argv: targets,
    logMessage: () => {
      // прогрес-статус markdownlint-cli2 (banner, Finding/Found/Linting/Summary) — не деталь
    },
    logError: message => {
      errorLines.push(message)
    }
  })
  if (code !== 0) {
    const detail = errorLines.length > 0 ? `:\n${errorLines.join('\n')}` : ''
    violations.push({
      ruleId: ctx.ruleId,
      concernId: ctx.concernId,
      reason: 'markdownlint',
      message: `markdownlint знайшов порушення у *.md/*.mdc (text.mdc)${detail}`
    })
  }

  return { violations }
}
