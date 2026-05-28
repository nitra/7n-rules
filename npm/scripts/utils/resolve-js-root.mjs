/**
 * Резолвить корінь JS-коду в проєкті: для workspace-projects — перший workspace
 * (з підтримкою glob-патернів типу `cf/*`), для single-package — корінь cwd.
 * Спільна утиліта для coverage-провайдера js-lint і test-концерну stryker_config (DRY).
 */
import { existsSync } from 'node:fs'
import { glob, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const WORKSPACE_GLOB_IGNORE = ['**/node_modules/**', '**/.git/**']

/**
 * Розгортає один workspace-патерн у список абсолютних шляхів каталогів з package.json.
 * Літеральні патерни перевіряються через existsSync; glob-патерни — через node:fs/promises#glob.
 * @param {string} cwd корінь проєкту
 * @param {string} pattern workspace-патерн з package.json (наприклад, `app` або `cf/*`)
 * @returns {Promise<string[]>} абсолютні шляхи до workspace-каталогів
 */
async function expandWorkspacePattern(cwd, pattern) {
  if (!pattern.includes('*')) {
    const wsPath = join(cwd, pattern)
    return existsSync(join(wsPath, 'package.json')) ? [wsPath] : []
  }
  const results = []
  for await (const rel of glob(`${pattern}/package.json`, { cwd, exclude: WORKSPACE_GLOB_IGNORE })) {
    const wsRel = rel.replace(/[/\\]package\.json$/, '')
    results.push(join(cwd, wsRel))
  }
  return results.sort()
}

/**
 * @param {string} cwd корінь проєкту (де `.n-cursor.json` і кореневий package.json)
 * @returns {Promise<string|null>} абсолютний шлях до JS-root або null без кореневого package.json
 */
export async function resolveJsRoot(cwd) {
  const roots = await resolveAllJsRoots(cwd)
  if (roots.length === 0) return null
  return roots[0]
}

/**
 * Plural-варіант: повертає всі JS-roots проєкту. Для workspace-projects — кожен
 * workspace з власним `package.json` (з розгортанням glob-патернів); для
 * single-package — `[cwd]`. Порожній масив без кореневого package.json.
 * @param {string} cwd корінь проєкту
 * @returns {Promise<string[]>} абсолютні шляхи до всіх JS-roots
 */
export async function resolveAllJsRoots(cwd) {
  const rootPkgPath = join(cwd, 'package.json')
  if (!existsSync(rootPkgPath)) return []
  const rootPkg = JSON.parse(await readFile(rootPkgPath, 'utf8'))
  const patterns = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : []
  if (patterns.length === 0) return [cwd]
  const roots = []
  for (const pattern of patterns) {
    roots.push(...(await expandWorkspacePattern(cwd, pattern)))
  }
  return roots.length > 0 ? roots : [cwd]
}
