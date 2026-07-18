/**
 * Спільні хелпери T0-автоміграторів сервіс-канону (ADR 260718-0835) для
 * CI-плагінів (`fix-service_deploy_pipeline` в ci-azure,
 * `fix-service_deploy_workflow` в ci-github): розбір `n-rules`-команд,
 * визначення релевантних доменів сервісу і фабрика T0-патерну. Винесено в
 * ядро, щоб мігратори двох CI не дублювали логіку (і не дрейфували в ній).
 */
import { existsSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { collectPathScopedFiles } from './path-scope.mjs'
import { loadEnabledLintRules, computeActiveDomains } from './run-detectors.mjs'

const WS_RE = /\s+/u

/**
 * Розбирає команду `n-rules lint …`/`n-rules ci plan …` токенами (без regex —
 * стійко до багаторядкових script-ів і без бектрекінгу).
 * @param {string} cmd повний текст команди кроку
 * @param {string} marker підрядок-початок (`n-rules lint` | `n-rules ci plan`)
 * @returns {{ domain: string|null, path: string|null }|null} розбір або null, якщо маркера немає
 */
export function parseNRulesCmd(cmd, marker) {
  const at = cmd.indexOf(marker)
  if (at === -1) return null
  const tokens = cmd
    .slice(at + marker.length)
    .split(WS_RE)
    .filter(Boolean)
  let domain = null
  let path = null
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '--path') {
      path = tokens[i + 1] ?? null
      i++
      continue
    }
    if (!t.startsWith('-') && domain === null && path === null) domain = t
  }
  return { domain, path }
}

/**
 * Релевантні домени сервісу: enabled-правила, чиї per-file glob-и матчать
 * бодай один файл піддерева (та сама таблиця, що `ci plan` по не-дельті).
 * @param {string} cwd корінь consumer-репо
 * @param {string} servicePath каталог сервісу
 * @returns {Promise<string[]>} відсортовані rule-id
 */
export async function relevantDomains(cwd, servicePath) {
  const abs = resolve(cwd, servicePath)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return []
  const files = await collectPathScopedFiles(cwd, servicePath)
  const { byRule, enabledSet } = await loadEnabledLintRules({ cwd })
  const active = computeActiveDomains(byRule, enabledSet, files)
  return active
    .entries()
    .filter(([, st]) => st.triggered)
    .map(([id]) => id)
    .toArray()
    .toSorted((a, b) => a.localeCompare(b))
}

/**
 * Фабрика T0-патерну мігратора: обходить файли з violations свого concern-а
 * і застосовує `migrateFile`; помилка окремого файлу — fail-open (deny
 * лишається детектору до ручного фіксу).
 * @param {{ id: string, migrateFile: (absPath: string, cwd: string) => Promise<boolean>, noun: string }} opts id патерну, мігратор файлу, іменник для повідомлення (`pipeline` | `workflow`)
 * @returns {import('./types.mjs').T0Pattern} T0-патерн для `patterns`-експорту fix-модуля
 */
export function createMigrationFixPattern({ id, migrateFile, noun }) {
  return {
    id,
    test: violations => violations.length > 0,
    async apply(violations, ctx) {
      const files = [...new Set(violations.map(v => v.file).filter(Boolean))]
      const touched = []
      for (const rel of files) {
        const abs = join(ctx.cwd, rel)
        if (!existsSync(abs)) continue
        try {
          if (await migrateFile(abs, ctx.cwd)) touched.push(abs)
        } catch {
          // міграція конкретного файлу не вдалася — лишаємо deny детектору (fail-open до ручного фіксу)
        }
      }
      return {
        touchedFiles: touched,
        message: touched.length > 0 ? `мігровано до сервіс-канону: ${touched.length} ${noun}(ів)` : null
      }
    }
  }
}
