/**
 * lint-поверхня php/project: read-only detector (`composer audit` + PHPStan + Psalm),
 * перейменовано з колишнього bundled `php/check` (spec
 * docs/specs/2026-07-02-text-check-per-file-split-design.md §5-A). `full`, без `lint.glob` —
 * phpstan/psalm потребують повного project-graph (autoload, class hierarchy), запуск на
 * одному файлі дає неповний/хибний результат; composer audit — project-wide dependency
 * audit. Не входять у delta-план (§5): спрацьовують лише через `n-rules lint --full` або
 * scoped `n-rules lint php`.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'

/**
 * @param {string} root корінь
 * @param {string} name ім'я у vendor/bin
 * @returns {string | null} абсолютний шлях до бінарника або null, якщо відсутній
 */
function vendorBin(root, name) {
  const p = resolve(root, 'vendor', 'bin', name)
  return existsSync(p) ? p : null
}

/**
 * Запускає тул і, на ненульовий код, реєструє порушення. Async (не блокує event loop) —
 * детектор може виконуватись у parallel lane `detectAll()` (ADR 260716-1354).
 * @param {string} label назва кроку
 * @param {string} abs абсолютний шлях
 * @param {string[]} args аргументи команди.
 * @param {string} cwd робочий каталог.
 * @param {(msg: string, reason: string) => void} fail колбек реєстрації порушення.
 * @param {string} reason машиночитна причина порушення.
 * @returns {Promise<boolean>} true якщо OK, false якщо порушення
 */
async function runTool(label, abs, args, cwd, fail, reason) {
  const r = await spawnAsync(abs, args, { cwd })
  if (r.exitCode === 0) return true
  const code = typeof r.exitCode === 'number' ? r.exitCode : 1
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
  const outSuffix = out ? `\n${out}` : ''
  fail(`lint-php: ${label} — помилка (код ${code}, php.mdc)${outSuffix}`, reason)
  return false
}

/**
 * Detector php/project (read-only). Async — `runTool` викликає `spawnAsync` (ADR 260716-1354).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат із порушеннями
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const root = ctx.cwd

  if (!existsSync(join(root, 'composer.json'))) return reporter.result()

  const composer = resolveCmd('composer')
  if (!composer) {
    fail('lint-php: `composer` не знайдено в PATH (потрібен при наявному composer.json, php.mdc)', 'composer-missing')
    return reporter.result()
  }

  if (
    !(await runTool('composer audit', composer, ['audit', '--no-interaction'], root, fail, 'composer-audit-violation'))
  ) {
    return reporter.result()
  }

  /**
   * @param {string} binName ім'я бінарника у vendor/bin.
   * @param {string} label назва кроку.
   * @param {string[]} args аргументи інструменту.
   * @param {string} reason машиночитна причина порушення.
   * @returns {Promise<boolean>} true якщо OK / пропущено
   */
  async function runOptionalVendorTool(binName, label, args, reason) {
    const abs = vendorBin(root, binName)
    if (!abs) return true // тул відсутній у vendor/bin → крок пропущено
    return await runTool(label, abs, args, root, fail, reason)
  }

  if (!(await runOptionalVendorTool('phpstan', 'PHPStan', ['analyse', '--no-progress'], 'phpstan-violation'))) {
    return reporter.result()
  }
  await runOptionalVendorTool('psalm', 'Psalm', ['--no-cache'], 'psalm-violation')

  return reporter.result()
}
