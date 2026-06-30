/**
 * Парсер і нормалізатор `concern.json`. Єдине місце де читається і валідується схема concern-а.
 * @see ../../schemas/concern.json
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @typedef {object} LintSurface
 * @property {'per-file'|'full'} scope
 * @property {string[]} glob масив glob-ів (нормалізований з string|string[]); порожній якщо не задано
 */

/**
 * @typedef {object} PolicySurface
 * @property {'rego'|'template'} engine канонічне поле; derived з legacy `check:'template'`
 * @property {{ single?: string, walkGlob?: string|string[], required?: boolean }} files
 * @property {'template'|undefined} check legacy (deprecated) — лишається для backward-compat
 * @property {string|undefined} missingMessage
 */

/**
 * @typedef {object} ConcernMeta
 * @property {string} name ім'я concern-а (= basename каталогу)
 * @property {string} dir абсолютний шлях до каталогу concern-а
 * @property {boolean} check чи є JS check поверхня
 * @property {PolicySurface|undefined} policy
 * @property {LintSurface|undefined} lint
 */

/**
 * Читає і нормалізує `concern.json` з каталогу.
 * Повертає `null` якщо файл відсутній або не валідний.
 * @param {string} concernDir абсолютний шлях до підкаталогу concern-а
 * @param {string} name ім'я concern-а (basename)
 * @returns {Promise<ConcernMeta|null>}
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

  /** @type {LintSurface|undefined} */
  let lint
  if (raw.lint && typeof raw.lint === 'object') {
    const scope = raw.lint.scope
    if (scope !== 'per-file' && scope !== 'full') return null
    const rawGlob = raw.lint.glob
    const glob = Array.isArray(rawGlob) ? rawGlob : typeof rawGlob === 'string' ? [rawGlob] : []
    lint = { scope, glob }
  }

  /** @type {PolicySurface|undefined} */
  let policy
  if (raw.policy && typeof raw.policy === 'object') {
    const legacyTemplate = raw.policy.check === 'template'
    const engine = raw.policy.engine === 'template' || raw.policy.engine === 'rego'
      ? raw.policy.engine
      : legacyTemplate
        ? 'template'
        : 'rego'
    policy = {
      engine,
      files: raw.policy.files,
      check: legacyTemplate ? 'template' : undefined,
      missingMessage: typeof raw.policy.missingMessage === 'string' ? raw.policy.missingMessage : undefined
    }
  }

  const check = raw.check === true

  if (!check && !policy && !lint) return null

  return { name, dir: concernDir, check, policy, lint }
}

/**
 * Сканує підкаталоги `ruleDir` і повертає всі concern-и (у алфавітному порядку).
 * Каталоги без `concern.json` ігноруються.
 * @param {string} ruleDir абсолютний шлях до `rules/<id>/`
 * @returns {Promise<ConcernMeta[]>}
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
