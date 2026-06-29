/**
 * lint-поверхня php: read-only detector (composer audit + PHPStan/Psalm/PHP-CS-Fixer/PHPCS).
 * Усі кроки — лише перевірки; PHP-CS-Fixer запускається в --dry-run (без правок).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'

const PHPCS_CODE_DIR_CANDIDATES = ['app', 'src', 'lib', 'public', 'www']

/**
 * @param {string} root корінь репозиторію
 * @returns {string[]} перелік шляхів для phpcs
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
 * @param {string} name ім'я у vendor/bin
 * @returns {string | null}
 */
function vendorBin(root, name) {
  const p = resolve(root, 'vendor', 'bin', name)
  return existsSync(p) ? p : null
}

/**
 * Запускає тул і, на ненульовий код, реєструє порушення.
 * @param {string} label назва кроку
 * @param {string} abs абсолютний шлях
 * @param {string[]} args
 * @param {string} cwd
 * @param {(msg: string, reason: string) => void} fail
 * @param {string} reason
 * @returns {boolean} true якщо OK, false якщо порушення
 */
function runTool(label, abs, args, cwd, fail, reason) {
  const r = spawnSync(abs, args, { cwd, encoding: 'utf8', shell: false })
  if (r.status === 0) return true
  const code = typeof r.status === 'number' ? r.status : 1
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 2000)
  fail(`lint-php: ${label} — помилка (код ${code}, php.mdc)${out ? `\n${out}` : ''}`, reason)
  return false
}

/**
 * Detector php/check (read-only).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult}
 */
export function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const root = ctx.cwd

  if (!existsSync(join(root, 'composer.json'))) {
    // немає composer.json → кроки PHP пропущено
    return reporter.result()
  }

  const composer = resolveCmd('composer')
  if (!composer) {
    fail('lint-php: `composer` не знайдено в PATH (потрібен при наявному composer.json, php.mdc)', 'composer-missing')
    return reporter.result()
  }

  if (!runTool('composer audit', composer, ['audit', '--no-interaction'], root, fail, 'composer-audit-violation')) {
    return reporter.result()
  }

  /**
   * @param {string} binName
   * @param {string} label
   * @param {string[]} args
   * @param {string} reason
   * @returns {boolean}
   */
  function runOptionalVendorTool(binName, label, args, reason) {
    const abs = vendorBin(root, binName)
    if (!abs) return true // тул відсутній у vendor/bin → крок пропущено
    return runTool(label, abs, args, root, fail, reason)
  }

  if (
    !runOptionalVendorTool(
      'php-cs-fixer',
      'PHP-CS-Fixer (dry-run)',
      ['fix', '--dry-run', '--diff'],
      'php-cs-fixer-violation'
    )
  ) {
    return reporter.result()
  }

  const phpcsPaths = getPhpcsCodePaths(root)
  if (
    !runOptionalVendorTool(
      'phpcs',
      'phpcs (Security)',
      ['--standard=Security', '--ignore=*/vendor/*,*/node_modules/*,*/.git/*', ...phpcsPaths],
      'phpcs-violation'
    )
  ) {
    return reporter.result()
  }

  if (!runOptionalVendorTool('phpstan', 'PHPStan', ['analyse', '--no-progress'], 'phpstan-violation')) {
    return reporter.result()
  }
  if (!runOptionalVendorTool('psalm', 'Psalm', ['--no-cache'], 'psalm-violation')) {
    return reporter.result()
  }

  return reporter.result()
}
