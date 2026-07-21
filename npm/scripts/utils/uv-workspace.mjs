/**
 * Спільні T0 (без spawn `uv`) утиліти для роботи з uv workspace-структурою: читання
 * `pyproject.toml`, резолв `[tool.uv.workspace].members`/`.exclude`-glob-патернів у
 * каталоги. Дзеркалить `cargo-workspace.mjs` (rust/workspace_root) — uv workspaces
 * навмисно змодельовані на Cargo workspaces, glob-семантика `members`/`exclude` та сама.
 * Не імпортується напряму з rust-боку (окремі плагіни) — дублювання свідоме.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import { parse as parseToml } from 'smol-toml'

import { scanGlob } from './glob-compat.mjs'

const TRAILING_SLASH_RE = /\/$/

/**
 * Розпарсений pyproject.toml або null (файл відсутній чи невалідний TOML).
 * @param {string} absPath абсолютний шлях до pyproject.toml
 * @returns {Promise<Record<string, unknown>|null>} розпарсений маніфест або null
 */
export async function readPyprojectManifest(absPath) {
  if (!existsSync(absPath)) return null
  try {
    return parseToml(await readFile(absPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Резолвить `[tool.uv.workspace].members`/`.exclude`-патерни (літеральні шляхи й прості
 * glob з `*`) відносно `rootDir` у список абсолютних каталогів, що мають власний
 * pyproject.toml. Без повної glob-семантики uv — лише `*`-сегменти й літерали.
 * @param {string} rootDir корінь workspace (каталог з pyproject.toml, де живе `[tool.uv.workspace]`)
 * @param {string[]} patterns патерни з `members`/`exclude`
 * @returns {Promise<string[]>} абсолютні шляхи (без дублікатів)
 */
export async function resolveUvWorkspaceMemberDirs(rootDir, patterns) {
  const found = new Set()
  for (const pattern of patterns ?? []) {
    const norm = pattern.replace(TRAILING_SLASH_RE, '')
    if (norm.includes('*')) {
      // Патерн для pyproject.toml напряму (не для каталогів) — деякі раннери (Bun.Glob)
      // за замовчуванням матчать лише файли, тож патерн на голий каталог даватиме 0 збігів.
      for await (const relManifest of scanGlob(`${norm}/pyproject.toml`, rootDir)) {
        found.add(resolve(rootDir, dirname(relManifest)))
      }
      continue
    }
    const abs = resolve(rootDir, norm)
    if (existsSync(`${abs}/pyproject.toml`)) found.add(abs)
  }
  return [...found]
}
