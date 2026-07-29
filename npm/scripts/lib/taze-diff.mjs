/** @see ./docs/taze-diff.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import { isBreaking } from './plugin-api.mjs'

/**
 * Спільне ядро taze-diff для мовних плагінів із JSON-маніфестами мапою
 * ім'я→constraint (package.json, composer.json): обходить поля залежностей
 * двох розпарсених маніфестів і класифікує кожну зміну версії на major
 * (breaking за caret-правилом `isBreaking`) чи minor/patch. Мітку джерела
 * (workspace/manifest) додає викликач — ядро повертає лише `{pkg, from, to}`.
 * @param {object} oldManifest розпарсений старий маніфест (бекап)
 * @param {object} newManifest розпарсений новий маніфест
 * @param {object} options параметри екосистеми
 * @param {string[]} options.fields поля маніфеста із залежностями (мапи ім'я→constraint)
 * @param {(spec: string) => {major:number, minor:number, patch:number}|null} options.parseVersion парсер версійного constraint-а екосистеми
 * @param {(pkg: string) => boolean} [options.filterPkg] предикат реальних пакетів (напр. відсіювання платформних псевдо-пакетів Composer)
 * @returns {{major: Array<{pkg:string, from:string, to:string}>, minorPatch:number}} зміни
 */
export function diffManifestDeps(oldManifest, newManifest, { fields, parseVersion, filterPkg }) {
  const major = []
  let minorPatch = 0
  for (const field of fields) {
    const oldDeps = oldManifest?.[field]
    const newDeps = newManifest?.[field]
    if (!oldDeps || !newDeps) continue
    for (const [pkg, from] of Object.entries(oldDeps)) {
      if (filterPkg && !filterPkg(pkg)) continue
      const to = newDeps[pkg]
      if (typeof from !== 'string' || typeof to !== 'string' || from === to) continue
      const fromV = parseVersion(from)
      const toV = parseVersion(to)
      if (fromV && toV && isBreaking(fromV, toV)) {
        major.push({ pkg, from, to })
      } else {
        minorPatch += 1
      }
    }
  }
  return { major, minorPatch }
}

/**
 * Читає й парсить JSON-файл, або повертає null, якщо файл відсутній/невалідний.
 * @param {string} path абсолютний шлях
 * @returns {Promise<object|null>} розпарсений обʼєкт або null
 */
export async function readJsonOrNull(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return null
  }
}
