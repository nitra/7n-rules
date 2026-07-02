/**
 * T0-autofix для `text/run-shellcheck` — `shellcheck -f diff` + `patch`, перенесено з колишнього
 * `text/check/fix-check.mjs` (spec docs/specs/2026-07-02-text-check-per-file-split-design.md §1).
 * `runShellcheckText(cwd, false)` сама ре-аналізує (diff+patch по колу) — per-violation дані тут
 * не потрібні, лише факт "shellcheck щось знайшов".
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { listShellScriptPaths, runShellcheckText } from './main.mjs'

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

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'text-shellcheck-fix',
    standalone: true, // §8 Phase 2: shellcheck diff+patch цикл сам ре-аналізує, test() не потрібен
    test: violations => violations.some(v => v.reason === 'shellcheck'),
    apply: (violations, ctx) => {
      const files = listShellScriptPaths(ctx.cwd)
      if (files.length === 0) return { touchedFiles: [] }
      const abs = files.map(f => resolve(ctx.cwd, f))
      const before = new Map(abs.map(a => [a, readOrNull(a)]))
      runShellcheckText(ctx.cwd, false)
      const touchedFiles = abs.filter(a => readOrNull(a) !== before.get(a))
      for (const a of touchedFiles) ctx.recordWrite?.(a)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `shellcheck --fix: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
]
