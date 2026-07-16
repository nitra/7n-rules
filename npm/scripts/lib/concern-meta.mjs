/**
 * Парсер і нормалізатор `concern.json`. Єдине місце де читається і валідується схема concern-а.
 * @see ../../schemas/concern.json
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @typedef {object} LintSurface
 * @property {'per-file'|'full'} scope область лінту: per-file чи повний прогін.
 * @property {string[]} glob масив glob-ів (нормалізований з string|string[]); порожній якщо не задано
 */

/**
 * @typedef {object} PolicySurface
 * @property {'rego'|'template'} engine канонічне поле; derived з legacy `check:'template'`
 * @property {{ single?: string, walkGlob?: string|string[], required?: boolean }} files опис файлів policy-поверхні.
 * @property {'template'|undefined} check legacy (deprecated) — лишається для backward-compat
 * @property {string|undefined} missingMessage повідомлення про відсутній файл (опційно).
 */

/**
 * @typedef {'code'|'config'|'structural'} Fixability
 */

/**
 * @typedef {object} ConcernMeta
 * @property {string} name ім'я concern-а (= basename каталогу)
 * @property {string|undefined} requiresCapability capability з `requires.capability` — концерн
 *   активний лише коли якийсь плагін декларує її у своєму маніфесті (напр. `ci:github`)
 * @property {string} dir абсолютний шлях до каталогу concern-а
 * @property {boolean} check чи є JS check поверхня
 * @property {PolicySurface|undefined} policy policy-поверхня concern-а (rego/template) або undefined.
 * @property {LintSurface|undefined} lint lint-поверхня concern-а або undefined.
 * @property {Fixability} fixability маршрутизація fix-движка (дефолт `code`): `config`/`structural` пропускають LLM-ladder.
 */

/**
 * Нормалізує `raw.fixability`. Невідоме/відсутнє значення → `code` (ladder-eligible дефолт).
 * @param {unknown} rawFixability сире поле `raw.fixability`
 * @returns {Fixability} нормалізована fixability-мітка
 */
function parseFixability(rawFixability) {
  return rawFixability === 'config' || rawFixability === 'structural' ? rawFixability : 'code'
}

/**
 * Нормалізує `raw.lint` у `LintSurface`. Повертає `null` при невалідному scope,
 * `undefined` якщо lint-блок відсутній.
 * @param {unknown} rawLint сирий блок `raw.lint`
 * @returns {LintSurface|null|undefined} нормалізована lint-поверхня, `null` (невалідний scope) або `undefined` (немає блоку)
 */
function parseLintSurface(rawLint) {
  if (!rawLint || typeof rawLint !== 'object') return
  const scope = rawLint.scope
  if (scope !== 'per-file' && scope !== 'full') return null
  const rawGlob = rawLint.glob
  let glob = []
  if (Array.isArray(rawGlob)) {
    glob = rawGlob
  } else if (typeof rawGlob === 'string') {
    glob = [rawGlob]
  }
  return { scope, glob }
}

/**
 * Нормалізує `raw.policy` у `PolicySurface` (engine derived з legacy `check:'template'`).
 * @param {unknown} rawPolicy сирий блок `raw.policy`
 * @returns {PolicySurface|undefined} нормалізована policy-поверхня або `undefined` якщо блоку немає
 */
function parsePolicySurface(rawPolicy) {
  if (!rawPolicy || typeof rawPolicy !== 'object') return
  const legacyTemplate = rawPolicy.check === 'template'
  let engine
  if (rawPolicy.engine === 'template' || rawPolicy.engine === 'rego') {
    engine = rawPolicy.engine
  } else {
    engine = legacyTemplate ? 'template' : 'rego'
  }
  return {
    engine,
    files: rawPolicy.files,
    check: legacyTemplate ? 'template' : undefined,
    missingMessage: typeof rawPolicy.missingMessage === 'string' ? rawPolicy.missingMessage : undefined
  }
}

/**
 * Читає і нормалізує `concern.json` з каталогу.
 * Повертає `null` якщо файл відсутній або не валідний.
 * @param {string} concernDir абсолютний шлях до підкаталогу concern-а
 * @param {string} name ім'я concern-а (basename)
 * @returns {Promise<ConcernMeta|null>} нормалізований meta або `null` якщо файл відсутній/невалідний.
 */
export async function readConcernMeta(concernDir, name) {
  const metaPath = join(concernDir, 'concern.json')
  if (!existsSync(metaPath)) return null
  let raw
  try {
    raw = JSON.parse(await readFile(metaPath, 'utf8'))
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null

  const lint = parseLintSurface(raw.lint)
  if (lint === null) return null

  const policy = parsePolicySurface(raw.policy)

  const check = raw.check === true

  if (!check && !policy && !lint) return null

  const requiresCapability =
    raw.requires && typeof raw.requires === 'object' && typeof raw.requires.capability === 'string'
      ? raw.requires.capability
      : undefined

  return { name, dir: concernDir, check, policy, lint, requiresCapability, fixability: parseFixability(raw.fixability) }
}

/**
 * Сканує підкаталоги `ruleDir` і повертає всі concern-и (у алфавітному порядку).
 * Каталоги без `concern.json` ігноруються.
 * @param {string} ruleDir абсолютний шлях до `rules/<id>/`
 * @returns {Promise<ConcernMeta[]>} масив concern-ів у алфавітному порядку.
 */
export async function listConcerns(ruleDir) {
  const { readdir } = await import('node:fs/promises')
  let entries
  try {
    entries = await readdir(ruleDir, { withFileTypes: true })
  } catch {
    return []
  }
  /** @type {ConcernMeta[]} */
  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const meta = await readConcernMeta(join(ruleDir, entry.name), entry.name)
    if (meta) out.push(meta)
  }
  return out.toSorted((a, b) => a.name.localeCompare(b.name))
}
