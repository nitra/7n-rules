/**
 * T0-autofix для `tauri/cargo_mutants_config` — детерміноване створення або
 * без-дублювання augment `<ws>/src-tauri/.cargo/mutants.toml` канонічними
 * Tauri-ключами. Логіку перенесено з detector-а (read-only contract: detector
 * лише звітує `mutants-config-missing` / `mutants-keys-missing`, запис — тут).
 *
 * Unified lint surface: structured violations (test(violations)/apply(violations,ctx)).
 * Цільові каталоги резолвимо повторним скануванням src-tauri від `ctx.cwd`;
 * стан кожного перевіряємо наново (idempotent — already-complete пропускаємо).
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  MUTANTS_CONFIG_MISSING,
  MUTANTS_KEYS_MISSING,
  buildAppended,
  buildBaseline,
  detectMissingKeys,
  findSrcTauriDirs
} from './main.mjs'

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'tauri-cargo-mutants-config-create',
    test: violations => violations.some(v => v.reason === MUTANTS_CONFIG_MISSING || v.reason === MUTANTS_KEYS_MISSING),
    apply: async (violations, ctx) => {
      const cwd = ctx.cwd
      const srcTauriDirs = await findSrcTauriDirs(cwd)
      const touchedFiles = []
      for (const srcTauriDir of srcTauriDirs) {
        const target = join(srcTauriDir, '.cargo', 'mutants.toml')
        if (!existsSync(target)) {
          ctx.recordWrite?.(target)
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, buildBaseline())
          touchedFiles.push(target)
          continue
        }
        const missing = await detectMissingKeys(target)
        if (missing.length === 0) continue
        ctx.recordWrite?.(target)
        const existing = await readFile(target, 'utf8')
        await writeFile(target, buildAppended(existing, missing))
        touchedFiles.push(target)
      }
      if (touchedFiles.length === 0) return { touchedFiles: [] }
      return { touchedFiles, message: `створено/доповнено Tauri .cargo/mutants.toml: ${touchedFiles.join(', ')}` }
    }
  }
]
