/**
 * Резолвить корінь JS-коду в проєкті: для workspace-projects — перший workspace
 * (наприклад `app/` у mail app), для single-package — корінь cwd. Спільна утиліта
 * для coverage-провайдера js-lint і test-концерну stryker_config (DRY).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * @param {string} cwd корінь проєкту (де `.n-cursor.json` і кореневий package.json)
 * @returns {Promise<string|null>} абсолютний шлях до JS-root або null без кореневого package.json
 */
export async function resolveJsRoot(cwd) {
  const rootPkgPath = join(cwd, 'package.json')
  if (!existsSync(rootPkgPath)) return null
  const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'))
  const workspaces = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : []
  if (workspaces.length > 0) {
    const wsPath = join(cwd, workspaces[0])
    if (existsSync(join(wsPath, 'package.json'))) return wsPath
  }
  return cwd
}

/**
 * Plural-варіант: повертає всі JS-roots проєкту. Для workspace-projects — кожен
 * workspace з власним `package.json`; для single-package — `[cwd]`. Порожній
 * масив без кореневого package.json. Використовується test-концерном
 * `stryker_config` для per-workspace baseline-копіювання.
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string[]>} абсолютні шляхи до всіх JS-roots
 */
export async function resolveAllJsRoots(cwd) {
  const rootPkgPath = join(cwd, 'package.json')
  if (!existsSync(rootPkgPath)) return []
  const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'))
  const workspaces = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : []
  if (workspaces.length === 0) return [cwd]
  const roots = []
  for (const ws of workspaces) {
    const wsPath = join(cwd, ws)
    if (existsSync(join(wsPath, 'package.json'))) roots.push(wsPath)
  }
  return roots.length > 0 ? roots : [cwd]
}
