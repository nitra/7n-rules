/**
 * Уніфікований маніфест пакета для перевірок changelog: `package.json` (npm/JS)
 * або `pyproject.toml` (Python / PEP 621, Poetry).
 */
import { existsSync } from 'node:fs'
import { glob, readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import { parse as parseToml } from 'smol-toml'

import { getMonorepoPackageRootDirs, isIgnoredWorkspaceRoot } from '../../../scripts/lib/workspaces.mjs'

/**
 * @typedef {'npm' | 'python'} PackageKind
 */

/**
 * @typedef {object} PackageManifest
 * @property {PackageKind} kind тип маніфесту
 * @property {string} ws відносний шлях воркспейсу (`'.'` для кореня)
 * @property {string} manifestRel `package.json` | `pyproject.toml`
 * @property {string | null} name ім'я пакета (npm / PyPI)
 * @property {string | null} version semver-рядок
 * @property {boolean} registryPublishable чи застосовується режим порівняння з реєстром
 * @property {string[] | null} [npmFiles] лише npm: `files` з package.json
 * @property {'major' | 'minor' | 'patch' | null} maxBump стеля для `n-rules release` (з `package.json#release.maxBump`); `null` — без обмеження
 */

const PYPROJECT_GLOB_IGNORE = ['**/node_modules/**', '**/.git/**', '**/.venv/**', '**/venv/**']
const VALID_MAX_BUMPS = new Set(['major', 'minor', 'patch'])

/**
 * @param {Record<string, unknown>} pkg розпарсений package.json
 * @returns {'major' | 'minor' | 'patch' | null} стеля бампа з `release.maxBump`, якщо валідна
 */
function maxBumpFromPackageJson(pkg) {
  const release = pkg.release
  if (!release || typeof release !== 'object' || Array.isArray(release)) return null
  const value = /** @type {Record<string, unknown>} */ (release).maxBump
  return typeof value === 'string' && VALID_MAX_BUMPS.has(value)
    ? /** @type {'major' | 'minor' | 'patch'} */ (value)
    : null
}

/**
 * @param {unknown} doc розпарсений pyproject.toml
 * @returns {{ name: string | null, version: string | null }} витягнуті поля project / tool.poetry
 */
function projectFieldsFromPyprojectDoc(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { name: null, version: null }
  }
  const root = /** @type {Record<string, unknown>} */ (doc)
  const project = root.project
  if (project && typeof project === 'object' && !Array.isArray(project)) {
    const p = /** @type {Record<string, unknown>} */ (project)
    return {
      name: typeof p.name === 'string' ? p.name : null,
      version: typeof p.version === 'string' ? p.version : null
    }
  }
  const tool = root.tool
  if (tool && typeof tool === 'object' && !Array.isArray(tool)) {
    const poetry = /** @type {Record<string, unknown>} */ (tool).poetry
    if (poetry && typeof poetry === 'object' && !Array.isArray(poetry)) {
      const po = /** @type {Record<string, unknown>} */ (poetry)
      return {
        name: typeof po.name === 'string' ? po.name : null,
        version: typeof po.version === 'string' ? po.version : null
      }
    }
  }
  return { name: null, version: null }
}

/**
 * @param {string} text вміст pyproject.toml
 * @returns {{ name: string | null, version: string | null }} витягнуті поля project / tool.poetry
 */
export function parsePyprojectFields(text) {
  try {
    return projectFieldsFromPyprojectDoc(parseToml(text))
  } catch {
    return { name: null, version: null }
  }
}

/**
 * @param {string} ws шлях воркспейсу (відносно `cwd`)
 * @param {string} [cwd] корінь репозиторію (за замовчуванням `process.cwd()`)
 * @returns {Promise<PackageManifest | null>} маніфест пакета або null
 */
export async function readPackageManifest(ws, cwd = process.cwd()) {
  const pkgPath = join(cwd, ws, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const parsed = JSON.parse(await readFile(pkgPath, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null
      }
      const pkg = /** @type {Record<string, unknown>} */ (parsed)
      const registryPublishable =
        typeof pkg.name === 'string' && pkg.name.length > 0 && pkg.private !== true && Array.isArray(pkg.files)
      return {
        kind: 'npm',
        ws,
        manifestRel: 'package.json',
        name: typeof pkg.name === 'string' ? pkg.name : null,
        version: typeof pkg.version === 'string' ? pkg.version : null,
        registryPublishable,
        npmFiles: Array.isArray(pkg.files) ? pkg.files : null,
        maxBump: maxBumpFromPackageJson(pkg)
      }
    } catch {
      return null
    }
  }

  const pyPath = join(cwd, ws, 'pyproject.toml')
  if (!existsSync(pyPath)) {
    return null
  }
  const fields = parsePyprojectFields(await readFile(pyPath, 'utf8'))
  const registryPublishable = Boolean(fields.name && fields.version)
  return {
    kind: 'python',
    ws,
    manifestRel: 'pyproject.toml',
    name: fields.name,
    version: fields.version,
    registryPublishable,
    npmFiles: null,
    maxBump: null
  }
}

/**
 * Каталоги пакетів: npm (`package.json` / workspaces) + Python (`pyproject.toml` без package.json).
 * @param {string} [repoRoot] параметр
 * @returns {Promise<string[]>} результат
 */
export async function getMonorepoProjectRootDirs(repoRoot = '.') {
  const roots = new Set(await getMonorepoPackageRootDirs(repoRoot))

  if (existsSync(join(repoRoot, 'pyproject.toml')) && !existsSync(join(repoRoot, 'package.json'))) {
    roots.add('.')
  }

  for await (const relPy of glob('**/pyproject.toml', { cwd: repoRoot, ignore: PYPROJECT_GLOB_IGNORE })) {
    const absDir = dirname(join(repoRoot, relPy))
    const relRoot = relative(repoRoot, absDir)
    const ws = relRoot === '' ? '.' : relRoot
    if (!isIgnoredWorkspaceRoot(ws) && !existsSync(join(repoRoot, ws, 'package.json'))) {
      roots.add(ws)
    }
  }

  const list = [...roots].filter(ws => !isIgnoredWorkspaceRoot(ws))
  list.sort((a, b) => {
    if (a === '.') return -1
    if (b === '.') return 1
    return a.localeCompare(b)
  })
  return list
}

/**
 * Шлях до файлу маніфесту воркспейсу.
 * @param {string} ws параметр
 * @param {PackageManifest} manifest параметр
 * @returns {string} результат
 */
export function manifestFilePath(ws, manifest) {
  return join(ws, manifest.manifestRel)
}
