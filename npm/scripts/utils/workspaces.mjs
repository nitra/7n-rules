/**
 * Допоміжний модуль для скриптів перевірки монорепо.
 *
 * Зчитує кореневий `package.json` і повертає список каталогів-пакетів (корінь `.` плюс шляхи
 * з `workspaces`, з урахуванням glob).
 */
import { existsSync } from 'node:fs'
import { glob, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

const TRAILING_SLASH_RE = /\/$/
const LEADING_DOTSLASH_RE = /^\.\//

/** Glob-ігнор для workspace-патернів із `*` (узгоджено з `rules/changelog/fix/consistency/package-manifest.mjs`). */
export const WORKSPACE_GLOB_IGNORE = Object.freeze(['**/node_modules/**', '**/.git/**', '**/.venv/**', '**/venv/**'])

/**
 * Чи слід виключити каталог зі списку workspace-коренів (не стосується `.`).
 * @param {string} ws відносний шлях воркспейсу
 * @returns {boolean} true — пропустити
 */
export function isIgnoredWorkspaceRoot(ws) {
  if (ws === '.') return false
  const p = ws.replaceAll('\\', '/').replace(LEADING_DOTSLASH_RE, '')
  const segments = new Set(p.split('/'))
  return segments.has('node_modules') || segments.has('.git') || segments.has('.venv') || segments.has('venv')
}

/**
 * Нормалізує workspace-патерн до POSIX-формату і прибирає хвостові `/`.
 * @param {string} pattern сирий workspace-патерн
 * @returns {string} нормалізований патерн або `.`
 */
function normalizeWorkspacePattern(pattern) {
  let normalized = pattern.replaceAll('\\', '/')
  while (TRAILING_SLASH_RE.test(normalized)) {
    normalized = normalized.slice(0, -1)
  }
  return normalized || '.'
}

/**
 * Додає каталоги пакетів до set за workspace-патерном.
 * @param {Set<string>} roots set коренів пакетів
 * @param {string} repoRoot корінь репозиторію
 * @param {string} workspacePattern нормалізований workspace-патерн
 * @returns {Promise<void>}
 */
async function addWorkspaceRootsByPattern(roots, repoRoot, workspacePattern) {
  if (workspacePattern.includes('*')) {
    const globPat = `${workspacePattern}/package.json`
    for await (const relPkgJsonPath of glob(globPat, {
      cwd: repoRoot,
      ignore: [...WORKSPACE_GLOB_IGNORE]
    })) {
      const absPkgJsonPath = join(repoRoot, relPkgJsonPath)
      const relRoot = relative(repoRoot, dirname(absPkgJsonPath))
      const ws = relRoot === '' ? '.' : relRoot
      if (!isIgnoredWorkspaceRoot(ws)) {
        roots.add(ws)
      }
    }
    return
  }

  const pkgJsonPath = join(repoRoot, workspacePattern, 'package.json')
  if (existsSync(pkgJsonPath) && !isIgnoredWorkspaceRoot(workspacePattern)) {
    roots.add(workspacePattern)
  }
}

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
    const workspacePattern = normalizeWorkspacePattern(raw)
    await addWorkspaceRootsByPattern(roots, repoRoot, workspacePattern)
  }
  const list = [...roots].filter(ws => !isIgnoredWorkspaceRoot(ws))
  list.sort((a, b) => {
    if (a === '.') return -1
    if (b === '.') return 1
    return a.localeCompare(b)
  })
  return list
}
