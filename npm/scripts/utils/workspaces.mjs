import { existsSync } from 'node:fs'
import { glob, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

/**
 * Нормалізує поле `workspaces` з package.json до масиву шляхів / glob-патернів.
 * @param {unknown} workspaces значення `workspaces` з кореневого package.json
 * @returns {string[]} масив патернів workspaces
 */
export function normalizeWorkspacePatterns(workspaces) {
  if (!workspaces) return []
  if (Array.isArray(workspaces)) return workspaces
  if (typeof workspaces === 'object' && workspaces !== null && Array.isArray(workspaces.packages)) {
    return workspaces.packages
  }
  return []
}

/**
 * Повертає каталоги з `package.json`: корінь репозиторію та всі пакети з `workspaces`.
 * @param {string} repoRoot зазвичай `process.cwd()`
 * @returns {Promise<string[]>} відносні шляхи до коренів пакетів; `'.'` першим, без дублікатів
 */
export async function getMonorepoPackageRootDirs(repoRoot = '.') {
  const roots = new Set(['.'])
  const rootPkgPath = join(repoRoot, 'package.json')
  if (!existsSync(rootPkgPath)) {
    return ['.']
  }
  const pkg = JSON.parse(await readFile(rootPkgPath, 'utf8'))
  for (const raw of normalizeWorkspacePatterns(pkg.workspaces)) {
    const w = raw.replaceAll('\\', '/').replace(/\/+$/, '') || '.'
    if (w.includes('*')) {
      const globPat = `${w}/package.json`
      for await (const f of glob(globPat, { cwd: repoRoot })) {
        const abs = join(repoRoot, f)
        const rel = relative(repoRoot, dirname(abs))
        roots.add(rel === '' ? '.' : rel)
      }
    } else {
      const pkgJson = join(repoRoot, w, 'package.json')
      if (existsSync(pkgJson)) roots.add(w)
    }
  }
  const list = [...roots]
  list.sort((a, b) => {
    if (a === '.') return -1
    if (b === '.') return 1
    return a.localeCompare(b)
  })
  return list
}
