/**
 * Читає компактну Git policy проєкту для delta, changelog і branch tooling.
 * Відсутній або неповний конфіг зберігає історичний канон `main`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const CONFIG_FILES = ['.n-rules.json', '.n-cursor.json']
const DEFAULT_BASE_BRANCH = 'main'

/**
 * @param {unknown} value потенційне ім'я гілки
 * @returns {string|null} нормалізоване ім'я або null
 */
function branchName(value) {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name.length > 0 ? name : null
}

/**
 * Повертає effective policy. `releaseBranches` одночасно є integration-кандидатами
 * delta та захищеними довгоживучими гілками; `baseBranch` додається до обох наборів.
 * @param {string} [cwd] корінь репозиторію
 * @returns {{baseBranch:string,releaseBranches:string[],integrationBranches:string[],protectedBranches:string[]}} effective Git policy
 */
export function readGitPolicy(cwd = process.cwd()) {
  let raw = null
  for (const file of CONFIG_FILES) {
    const path = join(cwd, file)
    if (!existsSync(path)) continue
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      // Повний CLI повідомить про невалідний JSON; standalone helpers лишаються safe-by-default.
    }
    break
  }
  const git = raw && typeof raw.git === 'object' && !Array.isArray(raw.git) ? raw.git : {}
  const baseBranch = branchName(git.baseBranch) ?? DEFAULT_BASE_BRANCH
  const configuredRelease = Array.isArray(git.releaseBranches)
    ? git.releaseBranches.map(value => branchName(value)).filter(Boolean)
    : []
  const releaseBranches = configuredRelease.length > 0 ? [...new Set(configuredRelease)] : [DEFAULT_BASE_BRANCH]
  const integrationBranches = [...new Set([baseBranch, ...releaseBranches])]
  return { baseBranch, releaseBranches, integrationBranches, protectedBranches: integrationBranches }
}
