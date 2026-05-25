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
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'

/** Каталоги/файли, які виключаємо з рекурсивного сканування dotenv-linter. */
const EXCLUDED_PATHS = ['node_modules', '.envrc']

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
 * Будує перелік аргументів `--exclude <path>` для dotenv-linter.
 * @returns {string[]} плоский масив `['--exclude', 'node_modules', '--exclude', '.envrc']`
 */
function buildExcludeArgs() {
  return EXCLUDED_PATHS.flatMap(p => ['--exclude', p])
}

/**
 * Запускає dotenv-linter з авто-фіксом і фінальною перевіркою.
 * @param {string} [cwd] робочий каталог (за замовчуванням `process.cwd()`)
 * @returns {number} 0 — OK; 1 — інструмент відсутній або є залишкові порушення
 */
export function runDotenvLinter(cwd = process.cwd()) {
  const root = resolve(cwd)
  const bin = resolveCmd('dotenv-linter')
  if (!bin) {
    printDotenvLinterInstallHints()
    return 1
  }

  const exclude = buildExcludeArgs()
  const fixRun = spawnSync(bin, ['fix', '-r', '--no-backup', '--quiet', ...exclude, '.'], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (fixRun.error) {
    process.stderr.write(`${fixRun.error.message}\n`)
    return 1
  }

  const checkRun = spawnSync(bin, ['check', '-r', '--quiet', ...exclude, '.'], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (checkRun.error) {
    process.stderr.write(`${checkRun.error.message}\n`)
    return 1
  }
  if (checkRun.status === 0) return 0
  if (checkRun.stdout?.length) process.stdout.write(checkRun.stdout)
  if (checkRun.stderr?.length) process.stderr.write(checkRun.stderr)
  return 1
}

if (isRunAsCli(import.meta.url)) {
  process.exitCode = runDotenvLinter()
}
