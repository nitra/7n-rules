/**
 * @see ./docs/tooling.md
 *
 * Nested Composer workspaces (ADR `2026-07-27-nested-composer-workspace-detection`): перевіряє
 * лише кореневий `composer.json`/`package.json` (свідоме обмеження — деталі в `tooling.mdc`).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'

/**
 * Перевіряє відповідність проєкту правилам php.mdc.
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  // `join(ctx.cwd, …)`, а НЕ голий відносний шлях: до порту в wasm-гість тут
  // стояв `existsSync('composer.json')`, тобто перевірка йшла від
  // `process.cwd()` замість `ctx.cwd`. У продакшені збігалось (оркестрація
  // завжди стартує з кореня лінтованого репо), тож дефект був невидимий —
  // і концерн не мав власних тестів. Виявлено при звірці з портом: гість
  // фізично не має `process.cwd()` і бачить лише host-побудований batch за
  // `ctx.cwd`, тож розбіжність спливла як неможливість відтворити канон.
  if (existsSync(join(ctx.cwd, 'composer.json'))) {
    pass('composer.json існує')
  } else {
    fail('composer.json не знайдено в корені — додай (php.mdc)')
  }

  if (existsSync(join(ctx.cwd, 'package.json'))) {
    pass('package.json є')
  } else {
    fail('package.json не знайдено в корені — додай (php.mdc)')
  }

  // Existence/структуру lint-php.yml вимагає провайдер-плагін @7n/rules-ci-github
  // (mixin php/lint_php_yml) — ядро провайдер-агностичне.
  return Promise.resolve(reporter.result())
}
