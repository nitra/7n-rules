/**
 * lint-поверхня php/cs_fixer: read-only detector (`php-cs-fixer fix --dry-run --diff`, з
 * `vendor/bin`). Per-file: приймає `ctx.files`, інакше `.` (весь проєкт). Виділено з колишнього
 * bundled `php/check` (spec docs/specs/2026-07-02-text-check-per-file-split-design.md "Рішення
 * python/php/rego") — php-cs-fixer приймає список конкретних файлів аргументом.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'

/** Розширення `.php` — фільтр delta-списку файлів у `lint(ctx)`. */
const PHP_EXT_RE = /\.php$/u

/**
 * @param {string} root корінь
 * @returns {string | null} абсолютний шлях до `vendor/bin/php-cs-fixer` або null, якщо відсутній
 */
function vendorBin(root) {
  const p = resolve(root, 'vendor', 'bin', 'php-cs-fixer')
  return existsSync(p) ? p : null
}

/**
 * Detector php/cs_fixer (read-only). Async (не блокує event loop) — детектор може виконуватись
 * у parallel lane `detectAll()` (ADR 260716-1354).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const root = ctx.cwd

  if (!existsSync(join(root, 'composer.json'))) return reporter.result()

  const targets = ctx.files === undefined ? ['.'] : ctx.files.filter(f => PHP_EXT_RE.test(f))
  if (targets.length === 0) return reporter.result()

  const abs = vendorBin(root)
  if (!abs) return reporter.result() // php-cs-fixer відсутній у vendor/bin → пропущено

  const r = await spawnAsync(abs, ['fix', '--dry-run', '--diff', ...targets], { cwd: root })
  if (r.exitCode !== 0) {
    const code = typeof r.exitCode === 'number' ? r.exitCode : 1
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
    const outSuffix = out ? `\n${out}` : ''
    fail(`lint-php: PHP-CS-Fixer (dry-run) — помилка (код ${code}, php.mdc)${outSuffix}`, 'php-cs-fixer-violation')
  }

  return reporter.result()
}
