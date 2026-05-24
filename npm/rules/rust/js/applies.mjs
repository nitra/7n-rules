/**
 * Applies-гейт правила rust: маркер — наявність `Cargo.toml` у `cwd` або
 * в будь-якому workspace-підкаталозі (рекурсивний пошук з пропуском
 * `node_modules`, `.git`, `.next`, `.turbo`). Якщо повертає `false` —
 * `runStandardRule` пропускає всі концерни (JS і policy) цього правила.
 * `check()` друкує тільки context-pass; реальна робота — у policy-концернах.
 */
import { existsSync } from 'node:fs'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'

import { hasCargoTomlInTree } from '../lib/has-cargo-toml.mjs'

const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', '.next', '.turbo'])

/**
 * @returns {Promise<boolean>} `true` — правило застосовне; `false` — пропустити
 */
export function applies() {
  if (existsSync('Cargo.toml')) return Promise.resolve(true)
  return Promise.resolve(hasCargoTomlInTree(process.cwd(), IGNORED_DIR_NAMES))
}

/**
 * @returns {number} exit-код (0 — OK, 1 — порушення)
 */
export function check() {
  const reporter = createCheckReporter()
  reporter.pass('Знайдено Cargo.toml — застосовуємо правила rust.mdc')
  return reporter.getExitCode()
}
