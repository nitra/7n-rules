/**
 * Light read-only `.n-rules.json` reader (fallback — legacy `.n-cursor.json`) для standalone `check.mjs` invocation.
 *
 * НЕ робить auto-rules detection, merge, schema sync — це справа повного `readConfig` у CLI.
 * Тут лише: прочитати файл (якщо є), повернути `{ rules: string[], disableRules: string[] }`.
 *
 * Спостереження whitelist:
 *   - якщо `.n-rules.json` НЕМАЄ → правило вважається enabled (поведінка "open by default"),
 *     щоб `bun rules/<id>/check.mjs` з будь-якої тимчасової директорії працювало для debug.
 *   - якщо файл є з `rules:[…]`, але правила там немає → правило не enabled.
 *   - якщо правило в `disable-rules` → не enabled, навіть якщо у `rules:[…]`.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const CONFIG_FILE = '.n-rules.json'
const LEGACY_CONFIG_FILE = '.n-cursor.json'

/**
 * @typedef {object} LiteConfig
 * @property {boolean} exists чи існує .n-rules.json (або legacy .n-rules.json) у поточному каталозі
 * @property {string[]} rules id правил з whitelist (порожній якщо файл відсутній)
 * @property {string[]} disableRules id правил, явно вимкнених у `disable-rules`
 * @property {string[] | undefined} plugins npm-пакети-плагіни з конфігу; undefined — поля немає (→ автодетект у resolve-plugins)
 */

/**
 * @param {string} [cwd] корінь, у якому шукати .n-rules.json (default — `process.cwd()`)
 * @returns {Promise<LiteConfig>} стан конфігу
 */
export async function readNRulesConfigLite(cwd = process.cwd()) {
  let configPath = join(cwd, CONFIG_FILE)
  if (!existsSync(configPath)) {
    configPath = join(cwd, LEGACY_CONFIG_FILE)
  }
  if (!existsSync(configPath)) {
    return { exists: false, rules: [], disableRules: [], plugins: undefined }
  }
  const raw = await readFile(configPath, 'utf8')
  /** @type {{ rules?: unknown, ['disable-rules']?: unknown, plugins?: unknown }} */
  const parsed = JSON.parse(raw)
  const rules = Array.isArray(parsed.rules) ? parsed.rules.filter(r => typeof r === 'string') : []
  const disableRules = Array.isArray(parsed['disable-rules'])
    ? parsed['disable-rules'].filter(r => typeof r === 'string')
    : []
  const plugins = Array.isArray(parsed.plugins) ? parsed.plugins.filter(p => typeof p === 'string') : undefined
  return { exists: true, rules, disableRules, plugins }
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
