/** @see ./docs/applies.md */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'

import { hasCargoTomlInTree } from '../lib/has-cargo-toml.mjs'

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.next', '.turbo'])

/**
 * @param {string} [cwd] корінь репозиторію
 * @returns {Promise<boolean>} `true` — правило застосовне; `false` — пропустити
 */
export function applies(cwd = process.cwd()) {
  if (existsSync(join(cwd, 'Cargo.toml'))) return Promise.resolve(true)
  return Promise.resolve(hasCargoTomlInTree(cwd, IGNORED_DIR_NAMES))
}

/**
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} результат context-pass
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  reporter.pass('Знайдено Cargo.toml — застосовуємо правила rust.mdc')
  return Promise.resolve(reporter.result())
}
