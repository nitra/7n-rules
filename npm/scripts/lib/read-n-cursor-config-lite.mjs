/**
 * Light read-only `.n-cursor.json` reader для standalone `check.mjs` invocation.
 *
 * НЕ робить auto-rules detection, merge, schema sync — це справа повного `readConfig` у CLI.
 * Тут лише: прочитати файл (якщо є), повернути `{ rules: string[], disableRules: string[] }`.
 *
 * Спостереження whitelist:
 *   - якщо `.n-cursor.json` НЕМАЄ → правило вважається enabled (поведінка "open by default"),
 *     щоб `bun rules/<id>/check.mjs` з будь-якої тимчасової директорії працювало для debug.
 *   - якщо файл є з `rules:[…]`, але правила там немає → правило не enabled.
 *   - якщо правило в `disable-rules` → не enabled, навіть якщо у `rules:[…]`.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const CONFIG_FILE = '.n-cursor.json'

/**
 * @typedef {object} LiteConfig
 * @property {boolean} exists чи існує .n-cursor.json у поточному каталозі
 * @property {string[]} rules id правил з whitelist (порожній якщо файл відсутній)
 * @property {string[]} disableRules id правил, явно вимкнених у `disable-rules`
 */

/**
 * @param {string} [cwd] корінь, у якому шукати .n-cursor.json (default — `process.cwd()`)
 * @returns {Promise<LiteConfig>} стан конфігу
 */
export async function readNCursorConfigLite(cwd = process.cwd()) {
  const configPath = join(cwd, CONFIG_FILE)
  if (!existsSync(configPath)) {
    return { exists: false, rules: [], disableRules: [] }
  }
  const raw = await readFile(configPath, 'utf8')
  /** @type {{ rules?: unknown, ['disable-rules']?: unknown }} */
  const parsed = JSON.parse(raw)
  const rules = Array.isArray(parsed.rules) ? parsed.rules.filter(r => typeof r === 'string') : []
  const disableRules = Array.isArray(parsed['disable-rules'])
    ? parsed['disable-rules'].filter(r => typeof r === 'string')
    : []
  return { exists: true, rules, disableRules }
}

/**
 * Чи активне правило згідно з конфігом.
 *   - файл відсутній → true (open by default для debug);
 *   - правило явно в `disable-rules` → false;
 *   - правило у `rules` → true;
 *   - інакше → false.
 * @param {LiteConfig} config розпарсений lite-конфіг
 * @param {string} ruleId id правила (= basename каталогу)
 * @returns {boolean} чи запускати правило
 */
export function isRuleEnabled(config, ruleId) {
  if (!config.exists) return true
  if (config.disableRules.includes(ruleId)) return false
  return config.rules.includes(ruleId)
}
