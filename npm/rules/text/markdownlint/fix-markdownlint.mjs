/**
 * T0-autofix для `text/markdownlint` — `markdownlint-cli2 --fix`, перенесено з колишнього
 * `text/check/fix-check.mjs` (spec docs/specs/2026-07-02-text-check-per-file-split-design.md §1).
 * Read-only детектор не мутує — apply() сам ре-аналізує вміст (markdownlint-cli2 --fix), тож
 * per-violation дані (рядок/колонка) тут не потрібні, лише факт "markdownlint щось знайшов".
 */
import { main as markdownlintCli2 } from 'markdownlint-cli2'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
 * Tracked *.md / *.mdc файли проєкту (через git).
 * @param {string} cwd корінь
 * @returns {string[]} posix-relative шляхи
 */
function listMarkdownFiles(cwd) {
  const r = spawnSync('git', ['ls-files', '-z', '--', '*.md', '*.mdc'], { cwd, encoding: 'utf8' })
  if (r.status !== 0) return []
  return (r.stdout ?? '').split('\0').filter(Boolean)
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'text-markdownlint-fix',
    standalone: true, // §8 Phase 2: markdownlint-cli2 --fix сам ре-аналізує, test() не потрібен
    test: violations => violations.some(v => v.reason === 'markdownlint'),
    apply: async (violations, ctx) => {
      const files = listMarkdownFiles(ctx.cwd)
      if (files.length === 0) return { touchedFiles: [] }
      const abs = files.map(f => resolve(ctx.cwd, f))
      const before = new Map(abs.map(a => [a, readOrNull(a)]))
      await markdownlintCli2({
        directory: ctx.cwd,
        argv: ['--fix', '**/*.md', '**/*.mdc'],
        logMessage: () => {
          // вивід markdownlint-cli2 глушимо — цікавлять лише змінені файли
        },
        logError: () => {
          // помилки markdownlint-cli2 глушимо — цікавлять лише змінені файли
        }
      })
      const touchedFiles = abs.filter(a => readOrNull(a) !== before.get(a))
      for (const a of touchedFiles) ctx.recordWrite?.(a)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `markdownlint --fix: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
]
