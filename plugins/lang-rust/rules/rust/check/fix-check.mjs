/** @see ./docs/fix-check.md */

/**
 * T0-autofix для `rust/check` — детермінований `cargo fmt --all`, що його read-only детектор
 * виконує лише з `--check`, плюс канонічна генерація `deny.toml` через `cargo deny init`
 * (`deny-config-missing`). clippy не автофіксимо (його `--fix` потенційно небезпечний) — ці
 * порушення й далі йдуть у LLM-ladder. Запис permanent. Відсутній `cargo`/`cargo-deny` → no-op.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

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
 * Tracked *.rs файли проєкту (через git). Async (не блокує event loop, ADR 260716-1354).
 * @param {string} cwd корінь
 * @returns {Promise<string[]>} posix-relative шляхи
 */
async function listRsFiles(cwd) {
  const r = await spawnAsync('git', ['ls-files', '-z', '--', '*.rs'], { cwd })
  if (r.exitCode !== 0) return []
  return (r.stdout ?? '').split('\0').filter(Boolean)
}

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'rust-cargo-fmt',
    standalone: true, // §8 Phase 2: apply самостійно перелічує *.rs (git ls-files), cargo fmt сам ре-аналізує
    test: violations => violations.some(v => v.reason === 'cargo-fmt-violation'),
    apply: async (violations, ctx) => {
      const cargo = resolveCmd('cargo')
      if (!cargo) return { touchedFiles: [] }
      const files = await listRsFiles(ctx.cwd)
      if (files.length === 0) return { touchedFiles: [] }

      const abs = files.map(f => resolve(ctx.cwd, f))
      const before = new Map(abs.map(a => [a, readOrNull(a)]))
      await spawnAsync(cargo, ['fmt', '--all'], { cwd: ctx.cwd })

      const touchedFiles = abs.filter(a => readOrNull(a) !== before.get(a))
      for (const a of touchedFiles) ctx.recordWrite?.(a)
      return touchedFiles.length > 0
        ? { touchedFiles, message: `cargo fmt: ${touchedFiles.length} файл(ів)` }
        : { touchedFiles: [] }
    }
  },
  {
    id: 'rust-cargo-deny-init',
    test: violations => violations.some(v => v.reason === 'deny-config-missing'),
    apply: async (violations, ctx) => {
      const cargo = resolveCmd('cargo')
      if (!cargo) return { touchedFiles: [] }
      const denyVersionResult = await spawnAsync(cargo, ['deny', '--version'])
      const hasDeny = denyVersionResult.exitCode === 0
      if (!hasDeny) return { touchedFiles: [] }

      const denyConfigPath = join(ctx.cwd, 'deny.toml')
      await spawnAsync(cargo, ['deny', 'init'], { cwd: ctx.cwd })
      if (!existsSync(denyConfigPath)) return { touchedFiles: [] }

      ctx.recordWrite?.(denyConfigPath)
      return { touchedFiles: [denyConfigPath], message: 'cargo deny init: deny.toml' }
    }
  }
]
