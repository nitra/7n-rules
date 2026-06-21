/**
 * Запуск `lint-php` за правилом php.mdc: `composer audit` і, якщо встановлені пакети, запуск
 * PHPStan, Psalm, PHP-CS-Fixer (dry-run) та PHPCS зі стандартом Security.
 *
 * Скрипт не вимагає, щоб усі інструменти були встановлені: якщо відповідного файла
 * `vendor/bin/<tool>` немає, крок пропускається з повідомленням. Але якщо в корені є
 * `composer.json`, то `composer` має бути доступний у PATH (інакше це помилка).
 *
 * Якщо `composer.json` у корені відсутній — вихід 0 без запуску інструментів.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { createCheckReporter } from '../../../scripts/lib/check-reporter.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { runStandardLint } from '../../../scripts/lib/run-standard-lint.mjs'

const PHPCS_CODE_DIR_CANDIDATES = ['app', 'src', 'lib', 'public', 'www']

/**
 * Каталоги коду для PHPCS (якщо типових директорій немає — перевіряємо `.`).
 * @param {string} root корінь репозиторію
 * @returns {string[]} перелік шляхів (відносно root), які варто передати у `phpcs`
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
 * @param {string} root корінь репозиторію
 * @param {string} name імʼя файла у vendor/bin
 * @returns {string | null} абсолютний шлях або null, якщо файла немає
 */
function vendorBin(root, name) {
  const p = resolve(root, 'vendor', 'bin', name)
  return existsSync(p) ? p : null
}

/**
 * @param {string} label назва кроку для повідомлень
 * @param {string} abs абсолютний шлях до CLI
 * @param {string[]} args аргументи
 * @param {(msg: string) => void} pass callback pass
 * @param {(msg: string) => void} fail callback fail
 * @returns {boolean} true якщо OK
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
 * Запускає `lint-php`.
 * @param {string} [cwd] корінь репозиторію
 * @returns {number} 0 — OK, 1 — є помилки
 */
export function run(cwd = process.cwd()) {
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

  /**
   * Запускає інструмент з `vendor/bin`, якщо він встановлений.
   * @param {string} binName імʼя файла у vendor/bin
   * @param {string} label назва кроку
   * @param {string[]} args аргументи CLI
   * @returns {boolean} true, якщо крок успішний або пропущений
   */
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
 * Оркестраторний адаптер `n-cursor lint php` (лінтер-фаза): composer audit + php-cs-fixer
 * (`--dry-run`) + phpstan/psalm через `run` у `runStandardLint` (лок). Read-only — мутацій
 * немає, тож `opts` ігнорується. Структурні php.mdc-перевірки — у конформність-фазі.
 * @param {string[] | undefined} _files ігнорується (whole-repo обхід)
 * @param {string} [cwd] корінь
 * @returns {Promise<number>} exit code
 */
export function lint(_files, cwd = process.cwd()) {
  return runStandardLint(import.meta.dirname, () => run(cwd))
}

if (isRunAsCli(import.meta.url)) {
  process.exitCode = run()
}
