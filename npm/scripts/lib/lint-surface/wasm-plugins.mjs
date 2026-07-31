/**
 * Резолвер wasm-плагінів plugin contract v3 (`n-rules:plugin@3.0.0`, задача K
 * фази 6, спека `docs/specs/2026-07-31-plugin-contract-v3-wasm-component.md`
 * §3.3) — читає секцію `wasmPlugins` з `.n-rules.json` консюмер-репо, для
 * кожного запису питає napi-міст `wasmPluginConcerns()` (`crates/rules-napi`)
 * і будує мапу «ключ концерну (`ruleId/concernId`) → абсолютний шлях `.wasm`».
 *
 * Формат конфігу — dev-пін (не фінальна дистрибуція спеки §3.4):
 * ```json
 * "wasmPlugins": [{ "name": "lang-js-pilot", "path": "./target/wasm32-wasip2/release/plugin_lang_js_pilot.wasm" }]
 * ```
 * TODO(v3-wasm-pilot): `url` + `sha256` hash-пін (спека §3.4, рішення Ж) —
 * наступний крок, поза обсягом пілоту; `path` тут — repo-relative шлях до вже
 * зібраного `.wasm`, без завантаження/кешу за хешем.
 *
 * Свідомо ОКРЕМА секція від `plugins` (масив npm-імен Plugin API v2,
 * `npm/scripts/lib/resolve-plugins.mjs`) — той ключ уже зайнятий закритим
 * контрактом (schema `npm/schemas/n-rules.json`, читачі
 * `read-n-rules-config-lite.mjs`/`resolve-plugins.mjs`/`n-rules-cli.mjs`),
 * перевикористання зламало б і schema-валідацію (v8r), і мовчазно відфільтрувало б
 * записи в чинних читачах (`typeof p === 'string'`).
 *
 * Skip-not-crash (спека §3.3, рішення З): запис із відсутнім/битим `.wasm`
 * ніколи не кидає — пропускається з warn-попередженням, `runConcernDetector`
 * (`detect.mjs`) падає назад на `main.mjs`, якщо той існує для того самого
 * concern-а (перехідне поводження, задокументоване там же).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { loadNative } from '../native.mjs'

/**
 * @typedef {object} WasmPluginConfigEntry
 * @property {string} name ідентифікатор плагіна (лише для diagnostics-повідомлень)
 * @property {string} path repo-relative (від `cwd`) чи абсолютний шлях до `.wasm`
 */

/**
 * Кеш «ключ концерну → абсолютний шлях .wasm», один на процес (той самий
 * мотив, що `nativeConcernKeys` у `detect.mjs`) — резолв конфігу й
 * `wasmPluginConcerns()` виконується раз.
 * @type {Map<string, string> | null}
 */
let wasmConcernMap = null

/**
 * Чи є значення валідним записом `wasmPlugins` (`{ name: string, path: string }`).
 * @param {unknown} entry елемент масиву `wasmPlugins`
 * @returns {entry is WasmPluginConfigEntry} true — валідний запис
 */
function isValidEntry(entry) {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (/** @type {Record<string, unknown>} */ (entry).name) === 'string' &&
    typeof (/** @type {Record<string, unknown>} */ (entry).path) === 'string'
  )
}

/**
 * Читає секцію `wasmPlugins` з `.n-rules.json` консюмер-репо. Відсутній файл,
 * невалідний JSON чи відсутнє/невалідне поле — порожній масив (skip-not-crash,
 * той самий мотив, що читачі `plugins` v2).
 * @param {string} cwd абсолютний корінь consumer-репо
 * @returns {WasmPluginConfigEntry[]} валідні записи `wasmPlugins`
 */
function readWasmPluginsConfig(cwd) {
  const configPath = join(cwd, '.n-rules.json')
  if (!existsSync(configPath)) return []
  /** @type {unknown} */
  let raw
  try {
    raw = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    return []
  }
  const entries = /** @type {{ wasmPlugins?: unknown }} */ (raw).wasmPlugins
  return Array.isArray(entries) ? entries.filter(entry => isValidEntry(entry)) : []
}

/**
 * Лениво резолвить мапу «ключ концерну → абсолютний шлях .wasm» з секції
 * `wasmPlugins` (доккомент модуля). Плагін з відсутнім/битим `.wasm` чи
 * `describe()`, що кидає — пропускається з `console.warn`, не валить резолв
 * решти плагінів.
 * @param {string} cwd абсолютний корінь consumer-репо (звідки читається `.n-rules.json`)
 * @returns {Map<string, string>} ключ концерну (`ruleId/concernId`) → абсолютний шлях `.wasm`
 */
export function resolveWasmConcernMap(cwd) {
  if (wasmConcernMap !== null) return wasmConcernMap
  const map = new Map()
  for (const entry of readWasmPluginsConfig(cwd)) {
    const wasmPath = resolve(cwd, entry.path)
    if (!existsSync(wasmPath)) {
      console.warn(`⚠️ wasm-плагін "${entry.name}" пропущено: файл не знайдено (${wasmPath})`)
      continue
    }
    let concerns
    try {
      concerns = loadNative().wasmPluginConcerns(wasmPath)
    } catch (error) {
      console.warn(`⚠️ wasm-плагін "${entry.name}" пропущено: не вдалось завантажити (${error.message})`)
      continue
    }
    for (const key of concerns) map.set(key, wasmPath)
  }
  wasmConcernMap = map
  return map
}

/**
 * Тестовий хук: скидає модульний кеш [`resolveWasmConcernMap`] — ізольовані
 * тести пишуть власний `.n-rules.json` на кожен `withTmpDir` і мають бачити
 * свіжий резолв, не кеш попереднього тесту.
 */
export function resetWasmConcernMapForTests() {
  wasmConcernMap = null
}
