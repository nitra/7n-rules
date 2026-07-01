/** @see ./docs/fix-check.md */

/**
 * T0-autofix для `text/check` — детерміновані авто-fix кроки тулчейну, що їх read-only
 * детектор не виконує:
 *   - `markdownlint --fix` для *.md/*.mdc (markdownlint-cli2 fix-режим);
 *   - `shellcheck -f diff | patch` для *.sh (через runShellcheckText, не-readOnly);
 *   - `dotenv-linter fix` для .env* (через runDotenvLinter, не-readOnly).
 * cspell/v8r fix-режиму не мають. Запис permanent (поза rollback).
 */
import { main as markdownlintCli2 } from 'markdownlint-cli2'
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, resolve, sep } from 'node:path'

import { listShellScriptPaths, runShellcheckText } from '../run-shellcheck/main.mjs'
import { runDotenvLinter } from '../run-dotenv-linter/main.mjs'

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
 * Знімає до-стан переданих файлів, виконує `runFix`, повертає абсолютні шляхи фактично
 * змінених файлів (спільний контракт для всіх під-тулів).
 * @param {string[]} relFiles posix-relative шляхи кандидатів
 * @param {string} cwd корінь
 * @param {() => unknown} runFix виклик тулу у fix-режимі (sync або async)
 * @returns {Promise<string[]>} абсолютні шляхи змінених файлів
 */
async function fixOverFiles(relFiles, cwd, runFix) {
  const abs = relFiles.map(f => resolve(cwd, f))
  const before = new Map(abs.map(a => [a, readOrNull(a)]))
  await runFix()
  return abs.filter(a => readOrNull(a) !== before.get(a))
}

/**
 * Tracked *.md / *.mdc файли проєкту (через git).
 * @param {string} cwd корінь
 * @returns {string[]} posix-relative шляхи
 */
function listMarkdownFiles(cwd) {
  const r = spawnSync('git', ['ls-files', '-z', '--', '*.md', '*.mdc'], { cwd, encoding: 'utf8' })
  if (r.status !== 0) return []
  return (r.stdout ?? '').split('\0').filter(Boolean)
}

/**
 * `.env*` файли проєкту (fs-walk — .env зазвичай git-ignored, тому не git ls-files).
 * Виключає node_modules, `.envrc` (direnv, не key=value) і `.bak`.
 * @param {string} cwd корінь
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

/**
 * Будує T0Pattern «перелічи файли → зафіксуй → звітуй змінені».
 * @param {string} id id патерну
 * @param {string} reason reason-порушення детектора, на який реагуємо
 * @param {(cwd: string) => string[]} listFiles перелік файлів-кандидатів
 * @param {(cwd: string) => unknown} runFix виклик тулу у fix-режимі
 * @param {string} label префікс debug-повідомлення
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern} готовий T0-патерн авто-fix
 */
function toolFixPattern(id, reason, listFiles, runFix, label) {
  return {
    id,
    test: violations => violations.some(v => v.reason === reason),
    apply: async (violations, ctx) => {
      const files = listFiles(ctx.cwd)
      if (files.length === 0) return { touchedFiles: [] }
      const touchedFiles = await fixOverFiles(files, ctx.cwd, () => runFix(ctx.cwd))
      for (const a of touchedFiles) ctx.recordWrite?.(a)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `${label}: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  toolFixPattern(
    'text-markdownlint-fix',
    'markdownlint',
    listMarkdownFiles,
    cwd =>
      markdownlintCli2({
        directory: cwd,
        argv: ['--fix', '**/*.md', '**/*.mdc'],
        logMessage: () => {
          // вивід markdownlint-cli2 глушимо — цікавлять лише змінені файли
        },
        logError: () => {
          // помилки markdownlint-cli2 глушимо — цікавлять лише змінені файли
        }
      }),
    'markdownlint --fix'
  ),
  toolFixPattern(
    'text-shellcheck-fix',
    'shellcheck',
    listShellScriptPaths,
    cwd => runShellcheckText(cwd, false),
    'shellcheck --fix'
  ),
  toolFixPattern(
    'text-dotenv-fix',
    'dotenv-linter',
    listEnvFiles,
    cwd => runDotenvLinter(cwd, false),
    'dotenv-linter fix'
  )
]
