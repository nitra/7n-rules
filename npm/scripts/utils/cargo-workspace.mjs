/**
 * Спільні T0 (без spawn `cargo`) утиліти для роботи з Cargo workspace-структурою:
 * читання Cargo.toml, резолв `[workspace].members`-glob-патернів у каталоги,
 * пошук найближчого предка-workspace root для крейту. Спільно використовується
 * `plugins/lang-rust/rules/rust/workspace_root` і `npm/rules/tauri/gitignore_target`.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { parse as parseToml } from 'smol-toml'

import { scanGlob } from './glob-compat.mjs'

const TRAILING_SLASH_RE = /\/$/

/**
 * Розпарсений Cargo.toml або null (файл відсутній чи невалідний TOML).
 * @param {string} absPath абсолютний шлях до Cargo.toml
 * @returns {Promise<Record<string, unknown>|null>} розпарсений маніфест або null
 */
export async function readCargoManifest(absPath) {
  if (!existsSync(absPath)) return null
  try {
    return parseToml(await readFile(absPath, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Резолвить `[workspace].members`/`.exclude`-патерни (літеральні шляхи й прості
 * glob з `*`) відносно `rootDir` у список абсолютних каталогів, що мають власний
 * Cargo.toml. Без повної Cargo glob-семантики — лише `*`-сегменти й літерали.
 * @param {string} rootDir корінь workspace (каталог з Cargo.toml, де живе `[workspace]`)
 * @param {string[]} patterns патерни з `members`/`exclude`
 * @returns {Promise<string[]>} абсолютні шляхи (без дублікатів)
 */
export async function resolveWorkspaceMemberDirs(rootDir, patterns) {
  const found = new Set()
  for (const pattern of patterns ?? []) {
    const norm = pattern.replace(TRAILING_SLASH_RE, '')
    if (norm.includes('*')) {
      // Шаблон для `Cargo.toml` напряму (не для каталогів) — деякі раннери (Bun.Glob)
      // за замовчуванням матчать лише файли, тож патерн на голий каталог даватиме 0 збігів.
      for await (const relManifest of scanGlob(`${norm}/Cargo.toml`, rootDir)) {
        found.add(resolve(rootDir, dirname(relManifest)))
      }
      continue
    }
    const abs = resolve(rootDir, norm)
    if (existsSync(join(abs, 'Cargo.toml'))) found.add(abs)
  }
  return [...found]
}

/**
 * Чи покриває `[workspace].members` (мінус `.exclude`) конкретний каталог-крейт.
 * @param {string} rootDir корінь workspace
 * @param {string} crateDirAbs абсолютний шлях крейту
 * @param {string[]} members `workspace.members`
 * @param {string[]} excludes `workspace.exclude`
 * @returns {Promise<boolean>} true — крейт є членом workspace
 */
export async function isWorkspaceMemberDir(rootDir, crateDirAbs, members, excludes) {
  const target = resolve(crateDirAbs)
  const memberDirs = await resolveWorkspaceMemberDirs(rootDir, members)
  if (memberDirs.every(d => resolve(d) !== target)) return false
  if (!excludes || excludes.length === 0) return true
  const excludedDirs = await resolveWorkspaceMemberDirs(rootDir, excludes)
  return excludedDirs.every(d => resolve(d) !== target)
}

/**
 * Йде від `dirname(crateDirAbs)` вгору по предках до `repoRootAbs` (включно),
 * шукаючи найближчий Cargo.toml з `[workspace]`, чиї `members` (мінус `exclude`)
 * покривають `crateDirAbs`. Не перевіряє сам `crateDirAbs` (виклик для нього — окремо).
 * @param {string} crateDirAbs абсолютний шлях крейту (напр. `<repo>/owner/src-tauri`)
 * @param {string} repoRootAbs абсолютний корінь репозиторію (межа обходу вгору)
 * @returns {Promise<{rootDir: string, parsed: Record<string, unknown>}|null>} найближчий ancestor workspace root або null
 */
export async function findAncestorWorkspaceRoot(crateDirAbs, repoRootAbs) {
  const stopAt = resolve(repoRootAbs)
  let dir = dirname(resolve(crateDirAbs))
  for (;;) {
    const parsed = await readCargoManifest(join(dir, 'Cargo.toml'))
    if (parsed?.workspace) {
      const members = Array.isArray(parsed.workspace.members) ? parsed.workspace.members : []
      const excludes = Array.isArray(parsed.workspace.exclude) ? parsed.workspace.exclude : []
      if (await isWorkspaceMemberDir(dir, crateDirAbs, members, excludes)) {
        return { rootDir: dir, parsed }
      }
    }
    if (dir === stopAt) return null
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
