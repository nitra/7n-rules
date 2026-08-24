/**
 * T0-autofix для `rust/cargo_mutants_config` — детерміноване створення
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

import { resolveAllCargoManifests } from '@7n/rules/scripts/utils/resolve-cargo-manifest.mjs'

/**
 * Стабільний reason, за яким T0 матчить порушення. Був експортом
 * `main.mjs` — переїхав СЮДИ, коли JS-детектор зняли: канон детекту тепер
 * `detect_cargo_mutants_config` wasm-гостя `crates/plugin-lang-rust`, і
 * фіксер лишився єдиним JS-споживачем цього рядка.
 *
 * Значення мусить збігатися з `CARGO_MUTANTS_CONFIG_MISSING_REASON` гостя
 * БАЙТ-У-БАЙТ — інакше `test()` нижче не побачить порушень, які гість
 * реально видає, і фікс тихо перестане спрацьовувати. Звірку тримає
 * parity-гейт (`wasm-plugin-parity-rust.test.mjs`) через фікстуру, що
 * подає вивід гостя саме в цей фіксер.
 */
const MUTANTS_CONFIG_MISSING = 'mutants-config-missing'

const BASELINE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'data',
  'cargo_mutants_config',
  'mutants.toml.baseline'
)

/** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'rust-cargo-mutants-config-create',
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
