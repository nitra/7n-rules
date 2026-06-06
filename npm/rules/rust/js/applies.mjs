/** @see ./docs/applies.md */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

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
 * @returns {number} exit-код (0 — OK, 1 — порушення)
 */
export function check() {
  const reporter = createCheckReporter()
  reporter.pass('Знайдено Cargo.toml — застосовуємо правила rust.mdc')
  return reporter.getExitCode()
}
