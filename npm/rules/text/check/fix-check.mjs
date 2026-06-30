/** @see ./docs/fix-check.md */

/**
 * T0-autofix для `text/check` — детерміновані авто-fix кроки тулчейну, що їх детектор
 * лишає read-only. Наразі: `markdownlint --fix` для *.md/*.mdc (markdownlint-cli2 у режимі
 * fix). Інші під-тули text/check вже само-фіксяться у своїх детекторах (dotenv-linter fix,
 * shellcheck diff+patch) або не мають fix-режиму (cspell/v8r). Запис permanent.
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
    test: violations => violations.some(v => v.reason === 'markdownlint'),
    apply: async (violations, ctx) => {
      const files = listMarkdownFiles(ctx.cwd)
      if (files.length === 0) return { touchedFiles: [] }
      const abs = files.map(f => resolve(ctx.cwd, f))
      const before = new Map(abs.map(a => [a, readOrNull(a)]))

      await markdownlintCli2({
        directory: ctx.cwd,
        argv: ['--fix', '**/*.md', '**/*.mdc'],
        logMessage: () => {},
        logError: () => {}
      })

      const touchedFiles = abs.filter(a => readOrNull(a) !== before.get(a))
      for (const a of touchedFiles) ctx.recordWrite?.(a)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `markdownlint --fix: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
]
