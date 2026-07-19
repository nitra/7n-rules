/**
 * T0-autofix для `python/ruff` — детерміновані `ruff check --fix` + `ruff format` (через
 * `uv run --frozen`), перенесено з колишнього `python/check/fix-check.mjs`
 * (spec docs/specs/2026-07-02-text-check-per-file-split-design.md "Рішення python/php/rego").
 * Відсутній `uv` → no-op.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { resolveCmd } from '@7n/rules/scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '@7n/rules/scripts/utils/spawn-async.mjs'

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
 * Async (не блокує event loop) — може виконуватись у parallel lane `detectAll()`
 * (ADR 260716-1354).
 * @param {string} cwd корінь
 * @returns {Promise<string[]>} posix-relative шляхи
 */
async function listPyFiles(cwd) {
  const r = await spawnAsync('git', ['ls-files', '-z', '--', '*.py'], { cwd })
  if (r.exitCode !== 0) return []
  return (r.stdout ?? '').split('\0').filter(Boolean)
}

/** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'python-ruff-fix',
    standalone: true, // §8 Phase 2: ruff check --fix + format самі ре-аналізують, test() не потрібен
    test: violations =>
      violations.some(v => v.reason === 'ruff-check-violation' || v.reason === 'ruff-format-violation'),
    apply: async (violations, ctx) => {
      const uv = resolveCmd('uv')
      if (!uv) return { touchedFiles: [] }
      const files = await listPyFiles(ctx.cwd)
      if (files.length === 0) return { touchedFiles: [] }

      const abs = files.map(f => resolve(ctx.cwd, f))
      const before = new Map(abs.map(a => [a, readOrNull(a)]))
      const opts = { cwd: ctx.cwd }
      await spawnAsync(uv, ['run', '--frozen', 'ruff', 'check', '--fix', '.'], opts)
      await spawnAsync(uv, ['run', '--frozen', 'ruff', 'format', '.'], opts)

      const touchedFiles = abs.filter(a => readOrNull(a) !== before.get(a))
      for (const a of touchedFiles) ctx.recordWrite?.(a)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `ruff check --fix + format: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
]
