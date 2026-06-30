/** @see ./docs/fix-check.md */

/**
 * T0-autofix для `python/check` — детерміновані `ruff check --fix` + `ruff format` (через
 * `uv run --frozen`, як детектор), що їх read-only детектор не виконує. Виправляє авто-fixable
 * ruff-правила і форматування; решта лишається детектору на re-check. Запис permanent.
 * Відсутній `uv` → no-op.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { resolveCmd } from '../../../scripts/utils/resolve-cmd.mjs'

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
 * Tracked *.py файли проєкту (через git).
 * @param {string} cwd корінь
 * @returns {string[]} posix-relative шляхи
 */
function listPyFiles(cwd) {
  const r = spawnSync('git', ['ls-files', '-z', '--', '*.py'], { cwd, encoding: 'utf8' })
  if (r.status !== 0) return []
  return (r.stdout ?? '').split('\0').filter(Boolean)
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'python-ruff-fix',
    test: violations =>
      violations.some(v => v.reason === 'ruff-check-violation' || v.reason === 'ruff-format-violation'),
    apply: (violations, ctx) => {
      const uv = resolveCmd('uv')
      if (!uv) return { touchedFiles: [] }
      const files = listPyFiles(ctx.cwd)
      if (files.length === 0) return { touchedFiles: [] }

      const abs = files.map(f => resolve(ctx.cwd, f))
      const before = new Map(abs.map(a => [a, readOrNull(a)]))
      const opts = { cwd: ctx.cwd, encoding: 'utf8', shell: false }
      spawnSync(uv, ['run', '--frozen', 'ruff', 'check', '--fix', '.'], opts)
      spawnSync(uv, ['run', '--frozen', 'ruff', 'format', '.'], opts)

      const touchedFiles = abs.filter(a => readOrNull(a) !== before.get(a))
      for (const a of touchedFiles) ctx.recordWrite?.(a)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `ruff check --fix + format: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
]
