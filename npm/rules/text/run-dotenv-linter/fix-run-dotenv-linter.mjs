/**
 * T0-autofix для `text/run-dotenv-linter` — `dotenv-linter fix`, перенесено з колишнього
 * `text/check/fix-check.mjs` (spec docs/specs/2026-07-02-text-check-per-file-split-design.md §1).
 * `runDotenvLinter(cwd, false)` сама застосовує всі виправлення — per-violation дані тут не
 * потрібні, лише факт "dotenv-linter щось знайшов".
 *
 * `runDotenvLinter`/`printDotenvLinterInstallHints`/`buildTargetArgs` перенесені сюди прямо
 * з колишнього `./main.mjs` (детекторний read-only бік — `lint(ctx)` — портований у native
 * `crates/rules-core/src/concerns/text_run_dotenv_linter.rs`, `main.mjs` видалено). Фіксер
 * лишається в JS і став самодостатнім, за зразком `text/oxfmt/fix-oxfmt.mjs` (`resolveCmd` +
 * `spawnAsync` напряму, без імпорту з видаленого detector-модуля).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { basename, resolve, sep } from 'node:path'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '../../../scripts/utils/spawn-async.mjs'

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
 * Вміст файлу або null, якщо не читається.
 * @param {string} abs абсолютний шлях
 * @returns {string|null} вміст або null
 */
function readOrNull(abs) {
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

/**
 * `.env*` файли проєкту (fs-walk — `.env` зазвичай git-ignored, тому не `git ls-files`).
 * Виключає `node_modules`, `.envrc` (direnv, не key=value) і `.bak`.
 * @param {string} cwd корінь репозиторію
 * @returns {string[]} relative шляхи
 */
function listEnvFiles(cwd) {
  let entries
  try {
    entries = readdirSync(cwd, { recursive: true, encoding: 'utf8' })
  } catch {
    return []
  }
  return entries.filter(p => {
    const base = basename(p)
    if (!base.startsWith('.env') || base === '.envrc' || base.endsWith('.bak')) return false
    return !p.split(sep).includes('node_modules')
  })
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'text-dotenv-fix',
    standalone: true, // §8 Phase 2: dotenv-linter fix сам ре-аналізує, test() не потрібен
    test: violations => violations.some(v => v.reason === 'dotenv-linter'),
    apply: async (violations, ctx) => {
      const files = listEnvFiles(ctx.cwd)
      if (files.length === 0) return { touchedFiles: [] }
      const abs = files.map(f => resolve(ctx.cwd, f))
      const before = new Map(abs.map(a => [a, readOrNull(a)]))
      await runDotenvLinter(ctx.cwd, false)
      const touchedFiles = abs.filter(a => readOrNull(a) !== before.get(a))
      for (const a of touchedFiles) ctx.recordWrite?.(a)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `dotenv-linter fix: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
]
