/**
 * lint-поверхня php: composer audit + PHPStan/Psalm/PHP-CS-Fixer/PHPCS.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { runStandardLint } from '../../../scripts/lib/run-standard-lint.mjs'

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
 * @param {string} label назва кроку
 * @param {string} abs абсолютний шлях
 * @param {string[]} args
 * @param {(msg: string) => void} pass
 * @param {(msg: string) => void} fail
 * @returns {boolean}
 */
function runTool(label, abs, args, pass, fail) {
  const r = spawnSync(abs, args, { stdio: 'inherit', shell: false })
  if (r.status === 0) {
    pass(`lint-php: ${label} — OK`)
    return true
  }
  const code = typeof r.status === 'number' ? r.status : 1
  fail(`lint-php: ${label} — помилка (код ${code}, php.mdc)`)
  return false
}

/**
 * Запускає кроки lint-php.
 * @param {string} [cwd] корінь
 * @returns {number} exit code
 */
export function runPhpLintSteps(cwd = process.cwd()) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const root = cwd
  if (!existsSync(join(root, 'composer.json'))) {
    pass('lint-php: немає composer.json у корені — кроки PHP пропущено')
    return reporter.getExitCode()
  }

  const composer = resolveCmd('composer')
  if (!composer) {
    fail('lint-php: `composer` не знайдено в PATH (потрібен при наявному composer.json, php.mdc)')
    return reporter.getExitCode()
  }

  if (!runTool('composer audit', composer, ['audit', '--no-interaction'], pass, fail)) return reporter.getExitCode()

  function runOptionalVendorTool(binName, label, args) {
    const abs = vendorBin(root, binName)
    if (!abs) {
      pass(`lint-php: vendor/bin/${binName} — відсутній, крок пропущено`)
      return true
    }
    return runTool(label, abs, args, pass, fail)
  }

  if (!runOptionalVendorTool('php-cs-fixer', 'PHP-CS-Fixer (dry-run)', ['fix', '--dry-run', '--diff'])) {
    return reporter.getExitCode()
  }

  const phpcsPaths = getPhpcsCodePaths(root)
  if (
    !runOptionalVendorTool('phpcs', 'phpcs (Security)', [
      '--standard=Security',
      '--ignore=*/vendor/*,*/node_modules/*,*/.git/*',
      ...phpcsPaths
    ])
  ) {
    return reporter.getExitCode()
  }

  if (!runOptionalVendorTool('phpstan', 'PHPStan', ['analyse', '--no-progress'])) return reporter.getExitCode()
  if (!runOptionalVendorTool('psalm', 'Psalm', ['--no-cache'])) return reporter.getExitCode()

  return reporter.getExitCode()
}

/**
 * lint-поверхня php.
 * @param {string[] | undefined} _files ігнорується
 * @param {string} [cwd] корінь
 * @returns {Promise<number>} exit code
 */
export function lint(_files, cwd = process.cwd()) {
  return runStandardLint(import.meta.dirname, () => runPhpLintSteps(cwd))
}
