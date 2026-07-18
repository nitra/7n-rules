/**
 * lint-поверхня php/phpcs: read-only detector (`phpcs --standard=Security`, з `vendor/bin`).
 * Per-file: приймає `ctx.files`, інакше типові код-каталоги (`app`/`src`/`lib`/`public`/`www`).
 * Виділено з колишнього bundled `php/check` (spec
 * docs/specs/2026-07-02-text-check-per-file-split-design.md "Рішення python/php/rego").
 */
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'

/** Розширення `.php` — фільтр delta-списку файлів у `lint(ctx)`. */
const PHP_EXT_RE = /\.php$/u

const PHPCS_CODE_DIR_CANDIDATES = ['app', 'src', 'lib', 'public', 'www']

/**
 * @param {string} root корінь репозиторію
 * @returns {string[]} перелік шляхів для phpcs (full-режим)
 */
export function getPhpcsCodePaths(root) {
  const out = []
  for (const d of PHPCS_CODE_DIR_CANDIDATES) {
    const p = join(root, d)
    if (existsSync(p) && statSync(p).isDirectory()) out.push(d)
  }
  return out.length > 0 ? out : ['.']
}

/**
 * @param {string} root корінь
 * @returns {string | null} абсолютний шлях до `vendor/bin/phpcs` або null, якщо відсутній
 */
function vendorBin(root) {
  const p = resolve(root, 'vendor', 'bin', 'phpcs')
  return existsSync(p) ? p : null
}

/**
 * Detector php/phpcs (read-only). Async (не блокує event loop) — детектор може виконуватись
 * у parallel lane `detectAll()` (ADR 260716-1354).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const root = ctx.cwd

  if (!existsSync(join(root, 'composer.json'))) return reporter.result()

  const targets = ctx.files === undefined ? getPhpcsCodePaths(root) : ctx.files.filter(f => PHP_EXT_RE.test(f))
  if (targets.length === 0) return reporter.result()

  const abs = vendorBin(root)
  if (!abs) return reporter.result() // phpcs відсутній у vendor/bin → пропущено

  const r = await spawnAsync(
    abs,
    ['--standard=Security', '--ignore=*/vendor/*,*/node_modules/*,*/.git/*', ...targets],
    { cwd: root }
  )
  if (r.exitCode !== 0) {
    const code = typeof r.exitCode === 'number' ? r.exitCode : 1
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
    const outSuffix = out ? `\n${out}` : ''
    fail(`lint-php: phpcs (Security) — помилка (код ${code}, php.mdc)${outSuffix}`, 'phpcs-violation')
  }

  return reporter.result()
}
