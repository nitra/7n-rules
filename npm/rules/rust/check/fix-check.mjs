/** @see ./docs/fix-check.md */

/**
 * T0-autofix для `rust/check` — детермінований `cargo fmt --all`, що його read-only детектор
 * виконує лише з `--check`. Виправляє форматування Rust-коду перед LLM-ладдером. clippy не
 * автофіксимо (його `--fix` потенційно небезпечний); deny.toml-генерація — окремо. Запис
 * permanent. Відсутній `cargo` → no-op.
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
 * Tracked *.rs файли проєкту (через git).
 * @param {string} cwd корінь
 * @returns {string[]} posix-relative шляхи
 */
function listRsFiles(cwd) {
  const r = spawnSync('git', ['ls-files', '-z', '--', '*.rs'], { cwd, encoding: 'utf8' })
  if (r.status !== 0) return []
  return (r.stdout ?? '').split('\0').filter(Boolean)
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'rust-cargo-fmt',
    standalone: true, // §8 Phase 2: apply самостійно перелічує *.rs (git ls-files), cargo fmt сам ре-аналізує
    test: violations => violations.some(v => v.reason === 'cargo-fmt-violation'),
    apply: (violations, ctx) => {
      const cargo = resolveCmd('cargo')
      if (!cargo) return { touchedFiles: [] }
      const files = listRsFiles(ctx.cwd)
      if (files.length === 0) return { touchedFiles: [] }

      const abs = files.map(f => resolve(ctx.cwd, f))
      const before = new Map(abs.map(a => [a, readOrNull(a)]))
      spawnSync(cargo, ['fmt', '--all'], { cwd: ctx.cwd, encoding: 'utf8', shell: false })

      const touchedFiles = abs.filter(a => readOrNull(a) !== before.get(a))
      for (const a of touchedFiles) ctx.recordWrite?.(a)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `cargo fmt: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  }
]
