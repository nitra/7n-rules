/**
 * Виявляє package-level documentation domains за маніфестами екосистем.
 *
 * Resolver не аналізує source: він лише фіксує стабільну identity домену та
 * вкладені межі, які downstream language adapters використають для обходу.
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { parse as parseToml } from 'smol-toml'

const MANIFESTS = new Map([
  ['package.json', 'npm'],
  ['Cargo.toml', 'cargo'],
  ['pyproject.toml', 'python'],
  ['composer.json', 'composer']
])

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.worktrees',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  '.venv',
  'venv'
])

/**
 * @typedef {'npm' | 'cargo' | 'python' | 'composer'} Ecosystem
 */

/**
 * @typedef {object} DocumentationDomain
 * @property {string} id path-independent `<ecosystem>:<canonical-name>` identity
 * @property {Ecosystem} ecosystem package ecosystem
 * @property {string} name canonical manifest name
 * @property {string} root absolute domain root for runtime adapters
 * @property {string} rootManifest posix-relative manifest path
 * @property {string} sourceRoot posix-relative domain root (`.` for repository root)
 * @property {string[]} sourceRoots source roots owned by this domain before exclusions
 * @property {string[]} excludedSourceRoots nested domain roots excluded from this domain
 */

/**
 * @typedef {object} DomainDiagnostic
 * @property {'error'} severity resolver diagnostics are publication-blocking
 * @property {'manifest-parse-failed' | 'manifest-name-missing' | 'duplicate-domain-id'} code stable diagnostic code
 * @property {string} manifest posix-relative manifest path
 * @property {string} message human-readable blocking explanation
 * @property {string} [domainId] colliding canonical identity
 * @property {string[]} [manifests] deterministically ordered colliding manifests
 */

/**
 * Converts a repository-relative path to stable POSIX form.
 * @param {string} path filesystem path
 * @returns {string} posix-relative path
 */
function toPosixRelative(path) {
  return path === '' || path === '.' ? '.' : path.split(sep).join('/')
}

/**
 * Canonicalizes package names according to ecosystem identity rules.
 * Python uses its PEP 503 canonical project-name form; the other manifests
 * already define canonical package identities and only need trimming.
 * @param {Ecosystem} ecosystem package ecosystem
 * @param {unknown} name raw manifest name
 * @returns {string | null} canonical name or null when unusable
 */
export function canonicalDomainName(ecosystem, name) {
  if (typeof name !== 'string' || name.trim() === '') return null
  const trimmed = name.trim()
  if (ecosystem === 'python') return trimmed.toLowerCase().replace(/[._-]+/gu, '-')
  if (ecosystem === 'composer') return trimmed.toLowerCase()
  return trimmed
}

/**
 * Reads the package name from one supported manifest without guessing when
 * parsing fails or its required name field is absent.
 * @param {Ecosystem} ecosystem package ecosystem
 * @param {string} manifestPath absolute manifest path
 * @returns {Promise<{ name: string | null, error: string | null }>}
 */
async function readManifestName(ecosystem, manifestPath) {
  try {
    const text = await readFile(manifestPath, 'utf8')
    if (ecosystem === 'npm' || ecosystem === 'composer') {
      const parsed = JSON.parse(text)
      const value = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.name : null
      return { name: canonicalDomainName(ecosystem, value), error: null }
    }

    const parsed = parseToml(text)
    const root = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    if (ecosystem === 'cargo') {
      const pkg = root.package
      const value = pkg && typeof pkg === 'object' && !Array.isArray(pkg) ? pkg.name : null
      return { name: canonicalDomainName(ecosystem, value), error: null }
    }

    const project = root.project
    const projectName = project && typeof project === 'object' && !Array.isArray(project) ? project.name : null
    const tool = root.tool
    const poetry = tool && typeof tool === 'object' && !Array.isArray(tool) ? tool.poetry : null
    const poetryName = poetry && typeof poetry === 'object' && !Array.isArray(poetry) ? poetry.name : null
    return { name: canonicalDomainName(ecosystem, projectName ?? poetryName), error: null }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { name: null, error: detail }
  }
}

/**
 * Lists supported manifest files below a repository root in lexical order.
 * Symlinks and conventional generated/dependency trees are deliberately not
 * traversed because they do not define source domains owned by this repository.
 * @param {string} directory absolute directory to scan
 * @returns {Promise<string[]>} absolute manifest paths
 */
async function listManifestPaths(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))
  const paths = []

  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) paths.push(...(await listManifestPaths(path)))
      continue
    }
    if (entry.isFile() && MANIFESTS.has(entry.name)) paths.push(path)
  }
  return paths
}

/**
 * Whether `candidate` is a strict descendant of `ancestor`, using path
 * segments rather than string-prefix matching (`apps/a` vs `apps/api`).
 * @param {string} candidate posix-relative path
 * @param {string} ancestor posix-relative path
 * @returns {boolean} whether candidate is below ancestor
 */
function isStrictDescendant(candidate, ancestor) {
  if (ancestor === '.') return candidate !== '.'
  return candidate.startsWith(`${ancestor}/`)
}

/**
 * Resolves every manifest-backed documentation domain in a repository.
 *
 * Returned domains and diagnostics are sorted by stable values. Invalid
 * manifests and duplicate canonical identities remain diagnostics instead of
 * silently receiving a path-derived fallback identity.
 * @param {string} [cwd] repository root
 * @returns {Promise<{ domains: DocumentationDomain[], diagnostics: DomainDiagnostic[] }>}
 */
export async function resolveDocumentationDomains(cwd = process.cwd()) {
  const repositoryRoot = resolve(cwd)
  const paths = await listManifestPaths(repositoryRoot)
  /** @type {DocumentationDomain[]} */
  const domains = []
  /** @type {DomainDiagnostic[]} */
  const diagnostics = []

  for (const manifestPath of paths) {
    const ecosystem = MANIFESTS.get(manifestPath.split(sep).at(-1))
    if (!ecosystem) continue
    const rootManifest = toPosixRelative(relative(repositoryRoot, manifestPath))
    const { name, error } = await readManifestName(ecosystem, manifestPath)
    if (error) {
      diagnostics.push({
        severity: 'error',
        code: 'manifest-parse-failed',
        manifest: rootManifest,
        message: `Не вдалося розібрати ${rootManifest}: ${error}`
      })
      continue
    }
    if (!name) {
      diagnostics.push({
        severity: 'error',
        code: 'manifest-name-missing',
        manifest: rootManifest,
        message: `${rootManifest} не містить канонічної назви package/crate/module`
      })
      continue
    }

    const sourceRoot = toPosixRelative(relative(repositoryRoot, dirname(manifestPath)))
    domains.push({
      id: `${ecosystem}:${name}`,
      ecosystem,
      name,
      root: dirname(manifestPath),
      rootManifest,
      sourceRoot,
      sourceRoots: [sourceRoot],
      excludedSourceRoots: []
    })
  }

  domains.sort((left, right) => left.id.localeCompare(right.id) || left.rootManifest.localeCompare(right.rootManifest))
  for (const domain of domains) {
    domain.excludedSourceRoots = domains
      .filter(candidate => isStrictDescendant(candidate.sourceRoot, domain.sourceRoot))
      .map(candidate => candidate.sourceRoot)
      .sort((left, right) => left.localeCompare(right))
  }

  const manifestsById = new Map()
  for (const domain of domains) {
    const manifests = manifestsById.get(domain.id) ?? []
    manifests.push(domain.rootManifest)
    manifestsById.set(domain.id, manifests)
  }
  for (const [domainId, manifests] of manifestsById) {
    if (manifests.length < 2) continue
    manifests.sort((left, right) => left.localeCompare(right))
    diagnostics.push({
      severity: 'error',
      code: 'duplicate-domain-id',
      manifest: manifests[0],
      domainId,
      manifests,
      message: `Канонічна identity ${domainId} повторюється: ${manifests.join(', ')}`
    })
  }
  diagnostics.sort((left, right) => left.code.localeCompare(right.code) || left.manifest.localeCompare(right.manifest))

  return { domains, diagnostics }
}

/**
 * Finds the owning domain for a source path. The deepest nested root wins;
 * paths outside the repository and manifest roots without a domain return null.
 * @param {DocumentationDomain[]} domains resolved domains
 * @param {string} sourcePath absolute or repository-relative source path
 * @param {string} [cwd] repository root used for relative source paths
 * @returns {DocumentationDomain | null} deepest owning domain
 */
export function resolveDomainForPath(domains, sourcePath, cwd = process.cwd()) {
  const repositoryRoot = resolve(cwd)
  const absolutePath = isAbsolute(sourcePath) ? resolve(sourcePath) : resolve(repositoryRoot, sourcePath)
  const relativePath = toPosixRelative(relative(repositoryRoot, absolutePath))
  if (relativePath === '..' || relativePath.startsWith('../')) return null

  const candidates = domains.filter(
    domain => relativePath === domain.sourceRoot || isStrictDescendant(relativePath, domain.sourceRoot)
  )
  candidates.sort((left, right) => {
    const depth = right.sourceRoot.split('/').length - left.sourceRoot.split('/').length
    return depth || left.id.localeCompare(right.id) || left.rootManifest.localeCompare(right.rootManifest)
  })
  return candidates[0] ?? null
}
