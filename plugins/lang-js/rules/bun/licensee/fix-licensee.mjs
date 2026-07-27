/**
 * T0-autofix для `bun/licensee` — канонічна ліцензійна policy й безпечне виправлення
 * метаданих власних Bun-workspace пакетів. Три патерни:
 *   1. `bun-licensee-config-init` — немає `.licensee.json`: `licensee --init` (canon-команда
 *      самого тула) + нормалізація канонічного SPDX-allowlist.
 *   2. `bun-licensee-canonical-policy` — `.licensee.json` вже є, але не пропускає канонічно
 *      дозволені SPDX (`ISC`, `BlueOak-1.0.0`, `0BSD`) — нормалізація без стирання
 *      користувацьких полів (existing spdx, `packages`, `corrections`).
 *   3. `bun-licensee-workspace-license-metadata` — власний package.json (root або
 *      Bun-workspace member), підтверджений `licensee`-звітом як `Invalid license metadata`
 *      (детектор передає ім'я пакета у `violation.data.package`), без поля `license` —
 *      додає канонічне `"license": "ISC"`.
 * Реальні `license-violation` від сторонніх пакетів — НЕ T0-фікс: потребують людського
 * рішення про ліцензійну політику, не regen.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { resolveAllJsRoots } from '@7n/rules/scripts/utils/resolve-js-root.mjs'
import { resolveCmd } from '@7n/rules/scripts/utils/resolve-cmd.mjs'
import { spawnAsync } from '@7n/rules/scripts/utils/spawn-async.mjs'

/**
 * Канонічний SPDX-allowlist policy (спец: MIT/BSD-2-Clause/BSD-3-Clause/Apache-2.0 —
 * дефолт самого `licensee --init`; ISC/BlueOak-1.0.0/0BSD — узгоджене розширення поточної
 * задачі, реальні транзитивні ліцензії consumer-репо).
 */
const CANONICAL_SPDX = ['MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'ISC', 'BlueOak-1.0.0', '0BSD']

/** Ліцензія, яку T0-фікс проставляє власним workspace-пакетам без `license` (bun.mdc). */
const DEFAULT_OWN_LICENSE = 'ISC'

/**
 * Читає `.licensee.json`, додає відсутні канонічні SPDX identifiers у `licenses.spdx`
 * (union, зберігаючи порядок і всі наявні користувацькі записи/поля — `packages`,
 * `corrections`), і перезаписує файл, лише якщо щось реально бракувало (ідемпотентність).
 * @param {string} configPath абсолютний шлях до `.licensee.json`
 * @param {(absPath: string) => void} [recordWrite] реєстрація запису для rollback
 * @returns {Promise<boolean>} чи файл було змінено
 */
async function normalizeCanonicalSpdx(configPath, recordWrite) {
  let config
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'))
  } catch {
    return false
  }
  const existing = Array.isArray(config.licenses?.spdx) ? config.licenses.spdx : []
  const existingSet = new Set(existing)
  const missing = CANONICAL_SPDX.filter(l => !existingSet.has(l))
  if (missing.length === 0) return false

  config.licenses = { ...config.licenses, spdx: [...existing, ...missing] }
  recordWrite?.(configPath)
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  return true
}

/**
 * Всі кандидати на власний package.json проєкту: кореневий + кожен Bun-workspace member
 * (`resolveAllJsRoots` розгортає `workspaces`-glob у корені).
 * @param {string} cwd абсолютний корінь consumer-репо
 * @returns {Promise<string[]>} абсолютні шляхи каталогів з package.json
 */
async function ownPackageDirs(cwd) {
  const roots = await resolveAllJsRoots(cwd)
  return [...new Set([cwd, ...roots])]
}

/** @type {import('@7n/rules/scripts/lib/lint-surface/types.mjs').T0Pattern[]} */
export const patterns = [
  {
    id: 'bun-licensee-config-init',
    test: violations => violations.some(v => v.reason === 'licensee-config-missing'),
    apply: async (violations, ctx) => {
      const bun = resolveCmd('bun')
      if (!bun) return { touchedFiles: [] }

      await spawnAsync(bun, ['x', 'licensee', '--init', '--production', '--quiet'], {
        cwd: ctx.cwd,
        shell: false
      })

      const configPath = join(ctx.cwd, '.licensee.json')
      if (!existsSync(configPath)) return { touchedFiles: [] }

      ctx.recordWrite?.(configPath)
      await normalizeCanonicalSpdx(configPath, ctx.recordWrite)
      return { touchedFiles: [configPath], message: 'licensee --init: .licensee.json' }
    }
  },
  {
    id: 'bun-licensee-canonical-policy',
    test: violations => violations.some(v => v.reason === 'license-violation'),
    apply: async (violations, ctx) => {
      const configPath = join(ctx.cwd, '.licensee.json')
      if (!existsSync(configPath)) return { touchedFiles: [] }

      const changed = await normalizeCanonicalSpdx(configPath, ctx.recordWrite)
      if (!changed) return { touchedFiles: [] }
      return { touchedFiles: [configPath], message: 'нормалізовано канонічний SPDX-allowlist .licensee.json' }
    }
  },
  {
    id: 'bun-licensee-workspace-license-metadata',
    test: violations => violations.some(v => v.reason === 'license-metadata-invalid' && v.data?.package),
    apply: async (violations, ctx) => {
      const packageNames = new Set(
        violations.filter(v => v.reason === 'license-metadata-invalid' && v.data?.package).map(v => v.data.package)
      )
      if (packageNames.size === 0) return { touchedFiles: [] }

      const dirs = await ownPackageDirs(ctx.cwd)
      const touchedFiles = []
      const messages = []

      for (const dir of dirs) {
        const pkgPath = join(dir, 'package.json')
        if (!existsSync(pkgPath)) continue

        let pkg
        try {
          pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
        } catch {
          continue
        }

        if (!packageNames.has(pkg.name) || Object.hasOwn(pkg, 'license')) continue

        pkg.license = DEFAULT_OWN_LICENSE
        ctx.recordWrite?.(pkgPath)
        writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
        touchedFiles.push(pkgPath)
        messages.push(`${pkg.name}: license = "${DEFAULT_OWN_LICENSE}"`)
      }

      return touchedFiles.length > 0 ? { touchedFiles, message: messages.join('; ') } : { touchedFiles: [] }
    }
  }
]
