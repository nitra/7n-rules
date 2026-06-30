/**
 * T0-autofix для `test/cargo_mutants_config` — детерміноване створення
 * `<cargoDir>/.cargo/mutants.toml` з canonical neutral baseline там, де його ще
 * немає. Логіку перенесено з detector-а (read-only contract: detector лише звітує
 * `mutants-config-missing`, запис — тут).
 *
 * Unified lint surface: structured violations (test(violations)/apply(violations,ctx)).
 * Цільові каталоги резолвимо повторним скануванням Cargo-маніфестів від `ctx.cwd`
 * (idempotent: existing target пропускаємо → touchedFiles лишається порожнім).
 */
import { existsSync } from 'node:fs'
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveAllCargoManifests } from '../../../scripts/utils/resolve-cargo-manifest.mjs'

import { MUTANTS_CONFIG_MISSING } from './main.mjs'

const BASELINE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'data',
  'cargo_mutants_config',
  'mutants.toml.baseline'
)

/** @type {import('../../../scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'test-cargo-mutants-config-create',
    test: violations => violations.some(v => v.reason === MUTANTS_CONFIG_MISSING),
    apply: async (violations, ctx) => {
      if (!existsSync(BASELINE_PATH)) return { touchedFiles: [] }
      const cwd = ctx.cwd
      const manifests = await resolveAllCargoManifests(cwd)
      const touchedFiles = []
      for (const manifestPath of manifests) {
        const target = join(dirname(manifestPath), '.cargo', 'mutants.toml')
        if (existsSync(target)) continue
        ctx.recordWrite?.(target)
        await mkdir(dirname(target), { recursive: true })
        await copyFile(BASELINE_PATH, target)
        touchedFiles.push(target)
      }
      if (touchedFiles.length === 0) return { touchedFiles: [] }
      return { touchedFiles, message: `створено .cargo/mutants.toml: ${touchedFiles.join(', ')}` }
    }
  }
]
