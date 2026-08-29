/** @see ./docs/fix-check.md */

/**
 * T0-autofix для `rust/check` — детермінований `cargo fmt --all`, що його read-only детектор
 * виконує лише з `--check`, плюс генерація `deny.toml` (`deny-config-missing`): якщо
 * `cargo-deny` встановлено — через `cargo deny init` (канонічний повний шаблон); якщо ні —
 * `MINIMAL_DENY_TOML`, детермінований мінімальний скаффолд. Обидва шляхи закривають
 * violation на T0, без LLM-ladder — раніше відсутність `cargo-deny` була no-op, і
 * `deny-config-missing` провалювався в LLM-fix, який галюцинував невалідну секцію `[deny]`
 * (у схемі cargo-deny таких немає — лише advisories/licenses/bans/sources/graph/output).
 * clippy не автофіксимо (його `--fix` потенційно небезпечний) — ці порушення й далі йдуть
 * у LLM-ladder. Запис permanent. Відсутній `cargo` → no-op.
 */
import { existsSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveCmd } from '@7n/rules/scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '@7n/rules/scripts/utils/spawn-async.mjs'

/**
 * Шлях до мінімального валідного `deny.toml` — звіреного проти реального `cargo deny init`
 * (cargo-deny 0.20.2): ті самі дефолтні значення (порожні `allow`-списки — deny-by-default
 * для licenses/bans, `warn` для bans/sources), лише без коментарів шаблону. `cargo deny check`
 * на цьому конфігу поводиться ідентично до щойно згенерованого `cargo deny init` — різниця
 * лише в тому, що дозволені ліцензії/пакети проєкту треба буде налаштувати вручну (як і з init).
 *
 * Вміст винесено в data-файл (той самий прийом, що `BASELINE_PATH`
 * `fix-cargo_mutants_config.mjs`) — рівно тому, що ТОЙ САМИЙ скаффолд тепер має
 * і wasm-порт (`fix_check`, `crates/plugin-lang-rust/src/lib.rs`, `include_str!`
 * цього ж файлу). Дублювання літерала в двох мовах розійшлося б беззвучно:
 * parity-тест звіряє байт-у-байт саме через спільне джерело.
 */
const MINIMAL_DENY_TOML_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'data',
  'check',
  'deny.toml.minimal'
)

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

/** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
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
      const denyConfigPath = join(ctx.cwd, 'deny.toml')
      const cargo = resolveCmd('cargo')
      if (cargo) {
        const denyVersionResult = await spawnAsync(cargo, ['deny', '--version'])
        if (denyVersionResult.exitCode === 0) {
          await spawnAsync(cargo, ['deny', 'init'], { cwd: ctx.cwd })
          if (existsSync(denyConfigPath)) {
            ctx.recordWrite?.(denyConfigPath)
            return { touchedFiles: [denyConfigPath], message: 'cargo deny init: deny.toml' }
          }
        }
      }

      // cargo-deny (або cargo) недоступний — детермінований мінімальний скаффолд
      // замість no-op: без цього violation провалювався в LLM-ladder, який галюцинував [deny].
      await writeFile(denyConfigPath, readFileSync(MINIMAL_DENY_TOML_PATH, 'utf8'), 'utf8')
      ctx.recordWrite?.(denyConfigPath)
      return {
        touchedFiles: [denyConfigPath],
        message: 'deny.toml: мінімальний детермінований скаффолд (cargo-deny не встановлено)'
      }
    }
  }
]
