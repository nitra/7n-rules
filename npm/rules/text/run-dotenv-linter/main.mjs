/**
 * Запуск dotenv-linter у ланцюжку lint-text: спочатку авто-фікс, потім фінальна перевірка.
 *
 * dotenv-linter — швидкий лінтер для `.env`-файлів (LowercaseKey, DuplicatedKey, IncorrectDelimiter,
 * UnorderedKey тощо). Інструмент очікується у PATH і **не** додається в `dependencies`/`devDependencies`
 * (аналогічно shellcheck). Якщо `dotenv-linter` відсутній — друкуємо підказки встановлення
 * (`brew install dotenv-linter` на macOS) і повертаємо 1.
 *
 * Файли шукає сам `dotenv-linter` у режимі `-r` (рекурсивно по дереву проєкту). Виключаємо
 * `node_modules` і `.envrc` (direnv shell-синтаксис, не key=value формат). `.bak`-файли інструмент
 * ігнорує самостійно. Якщо `.env*`-файлів немає, dotenv-linter повертає 0 ("Nothing to check").
 *
 * Авто-фікс — один прогон `dotenv-linter fix -r --no-backup --quiet . --exclude …` (інструмент сам
 * застосовує усі виправлення без потреби в diff/patch, на відміну від shellcheck). Після цього —
 * фінальний `dotenv-linter check -r --quiet . --exclude …`; будь-яке залишкове порушення — ненульовий
 * код виходу.
 */
import { resolve } from 'node:path'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'
import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'

/** Каталоги/файли, які виключаємо з рекурсивного сканування dotenv-linter. */
const EXCLUDED_PATHS = ['node_modules', '.envrc']

/** `.env`-файли — фільтр delta-списку файлів у `lint(ctx)` (basename, не розширення). */
const ENV_BASENAME_RE = /(?:^|\/)\.env(?:\.|$)/u

/**
 * Друкує підказки встановлення dotenv-linter у stderr.
 * @returns {void}
 */
function printDotenvLinterInstallHints() {
  process.stderr.write(
    [
      '❌ dotenv-linter не знайдено в PATH.',
      'Встанови інструмент і повтори lint-text:',
      '  macOS:    brew install dotenv-linter',
      '  Linux:    curl -sSfL https://git.io/JLbXn | sh -s -- -b /usr/local/bin',
      '  cargo:    cargo install dotenv-linter',
      ''
    ].join('\n')
  )
}

/**
 * Будує позиційні аргументи-цілі для dotenv-linter: явний список файлів (delta) або
 * рекурсивний `-r . --exclude …` (full — поточна поведінка без змін).
 * @param {string[]} [scopeFiles] явний перелік файлів
 * @returns {string[]} аргументи для `fix`/`check`
 */
function buildTargetArgs(scopeFiles) {
  if (scopeFiles !== undefined) return scopeFiles
  return ['-r', ...EXCLUDED_PATHS.flatMap(p => ['--exclude', p]), '.']
}

/**
 * Запускає dotenv-linter з авто-фіксом і фінальною перевіркою.
 * Async (не блокує event loop) — детектор може виконуватись у parallel lane `detectAll()`
 * (ADR 260716-1354).
 * @param {string} [cwd] робочий каталог (за замовчуванням `process.cwd()`)
 * @param {boolean} [readOnly] true → пропустити авто-фікс (`fix`), лише `check` (нуль мутацій)
 * @param {string[]} [scopeFiles] явний перелік `.env*`-файлів (delta) — якщо не задано, рекурсивний `-r .`
 * @returns {Promise<number>} 0 — OK; 1 — інструмент відсутній або є залишкові порушення
 */
export async function runDotenvLinter(cwd, readOnly, scopeFiles) {
  const root = resolve(cwd ?? process.cwd())
  const bin = resolveCmd('dotenv-linter')
  if (!bin) {
    printDotenvLinterInstallHints()
    return 1
  }

  const targets = buildTargetArgs(scopeFiles)
  if (!readOnly) {
    try {
      await spawnAsync(bin, ['fix', '--no-backup', '--quiet', ...targets], { cwd: root, env: process.env })
    } catch (error) {
      process.stderr.write(`${error.message}\n`)
      return 1
    }
  }

  let checkRun
  try {
    checkRun = await spawnAsync(bin, ['check', '--quiet', ...targets], { cwd: root, env: process.env })
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return 1
  }
  if (checkRun.exitCode === 0) return 0
  if (checkRun.stdout?.length) process.stdout.write(checkRun.stdout)
  if (checkRun.stderr?.length) process.stderr.write(checkRun.stderr)
  return 1
}

/**
 * Detector text/run-dotenv-linter: read-only dotenv-linter по `ctx.files` (delta) або по всіх `.env*` (full).
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст lint-прогону
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат detector-а
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { fail } = reporter
  const scopeFiles = ctx.files === undefined ? undefined : ctx.files.filter(f => ENV_BASENAME_RE.test(f))
  if (scopeFiles !== undefined && scopeFiles.length === 0) return reporter.result()

  const code = await runDotenvLinter(ctx.cwd, true, scopeFiles)
  if (code !== 0) fail('dotenv-linter знайшов порушення у .env* (text.mdc)', 'dotenv-linter')
  return reporter.result()
}

if (isRunAsCli(import.meta.url)) {
  process.exitCode = await runDotenvLinter()
}
