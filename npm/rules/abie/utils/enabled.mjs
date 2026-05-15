/**
 * Rule-level applies-гейт abie: чи `.n-cursor.json:rules` містить `abie`.
 * Використовується `js/applies/check.mjs` як `applies()`-експорт — якщо false,
 * CLI пропускає всі концерни правила (включно з policy).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const CONFIG_FILE = '.n-cursor.json'

/**
 * Чи увімкнено правило **abie** у `.n-cursor.json:rules`.
 * @param {string} root корінь репозиторію (cwd)
 * @returns {Promise<boolean>} `true` — `rules` містить `abie`; `false` — інакше
 */
export async function isAbieRuleEnabled(root) {
  const p = join(root, CONFIG_FILE)
  if (!existsSync(p)) return false
  let raw
  try {
    raw = await readFile(p, 'utf8')
  } catch {
    return false
  }
  let cfg
  try {
    cfg = JSON.parse(raw)
  } catch {
    return false
  }
  const rules = cfg?.rules
  if (!Array.isArray(rules)) return false
  return rules.some(r => String(r).trim().toLowerCase() === 'abie')
}
