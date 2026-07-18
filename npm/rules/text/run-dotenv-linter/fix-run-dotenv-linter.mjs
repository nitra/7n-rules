/**
 * T0-autofix для `text/run-dotenv-linter` — `dotenv-linter fix`, перенесено з колишнього
 * `text/check/fix-check.mjs` (spec docs/specs/2026-07-02-text-check-per-file-split-design.md §1).
 * `runDotenvLinter(cwd, false)` сама застосовує всі виправлення — per-violation дані тут не
 * потрібні, лише факт "dotenv-linter щось знайшов".
 */
import { readFileSync, readdirSync } from 'node:fs'
import { basename, resolve, sep } from 'node:path'

import { runDotenvLinter } from './main.mjs'

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
