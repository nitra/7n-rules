/**
 * Перевіряє, що в кожному workspace із релізно-релевантними змінами підвищена `version`
 * у маніфесті (`package.json` або `pyproject.toml`) і в `<ws>/CHANGELOG.md` є запис
 * `## [version] - YYYY-MM-DD` (формат Keep a Changelog).
 *
 * Дві моделі бази — на рівні воркспейсу (див. n-changelog.mdc):
 *
 * 1) **registry-published** (npm: `name` + `files`, не `private`; Python: `project.name` +
 *    статична `project.version` у `pyproject.toml`): база = опублікована версія в npm / PyPI.
 *    Якщо локальна версія відрізняється — потрібен CHANGELOG; для npm також `"CHANGELOG.md"`
 *    у `files`. Якщо версії збігаються, але в git є релевантні зміни без bump — fail.
 *
 * 2) **local-only** (приватні npm, без `files`, Python без імені/версії для реєстру): PR-scoped
 *    перевірка проти `dev` / `main` через `git merge-base`.
 *
 * Усі `git` і зовнішні виклики — через `execFile` / `fetch`, без shell-інтерполяції.
 */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'
import {
  getMonorepoProjectRootDirs,
  manifestFilePath,
  parsePyprojectFields,
  readPackageManifest
} from '../../../../scripts/utils/package-manifest.mjs'

const execFileAsync = promisify(execFile)

/** Кандидати інтеграційної гілки (перша наявна в репо; див. n-changelog.mdc) */
const BASE_BRANCH_CANDIDATES = Object.freeze(['dev', 'main'])

/** Гілки, на яких local-only перевірку пропускаємо (крім незакомічених registry-published). */
const INTEGRATION_BRANCHES = Object.freeze(['dev', 'main'])

/** Префікси шляхів (posix), які не вважаються релізними змінами — інверсія glob (n-changelog.mdc). */
const CHANGELOG_IGNORE_PATH_PREFIXES = Object.freeze(['docs/', 'doc/'])

/** Точні шляхи каталогів документації (posix), без bump. */
const CHANGELOG_IGNORE_PATH_EXACT = Object.freeze(['docs', 'doc'])

/** Таймаут на `npm view` / PyPI (мс) */
const REGISTRY_TIMEOUT_MS = 10_000

const LEADING_DOTSLASH_RE = /^\.\//

/**
 * Тихо запускає `git` і повертає stdout або `null` при будь-якій помилці.
 * @param {string[]} args аргументи `git`
 * @returns {Promise<string | null>} результат
 */
async function gitOrNull(args) {
  try {
    const { stdout } = await execFileAsync('git', args)
    return stdout
  } catch {
    return null
  }
}

/**
 * @returns {Promise<boolean>} результат
 */
async function isInsideGitRepo() {
  const out = await gitOrNull(['rev-parse', '--is-inside-work-tree'])
  return typeof out === 'string' && out.trim() === 'true'
}

/**
 * @returns {Promise<string | null>} результат
 */
async function currentBranchName() {
  const out = await gitOrNull(['rev-parse', '--abbrev-ref', 'HEAD'])
  return typeof out === 'string' ? out.trim() : null
}

/**
 * @param {string | null} branch параметр
 * @returns {boolean} результат
 */
function isIntegrationBranch(branch) {
  return branch !== null && INTEGRATION_BRANCHES.includes(branch)
}

/**
 * @param {string} ref параметр
 * @returns {string} результат
 */
function baseRefLabel(ref) {
  return ref.startsWith('origin/') ? ref.slice('origin/'.length) : ref
}

/**
 * @param {string} relPath параметр
 * @returns {boolean} результат
 */
function isChangelogIgnoredPath(relPath) {
  const p = relPath.replaceAll('\\', '/').replace(LEADING_DOTSLASH_RE, '')
  if (CHANGELOG_IGNORE_PATH_EXACT.includes(p)) {
    return true
  }
  return CHANGELOG_IGNORE_PATH_PREFIXES.some(prefix => p.startsWith(prefix))
}

/**
 * @param {string} relPath параметр
 * @returns {Promise<boolean>} результат
 */
async function isPathGitIgnored(relPath) {
  try {
    await execFileAsync('git', ['check-ignore', '-q', '--', relPath])
    return true
  } catch {
    return false
  }
}

/**
 * @returns {Promise<string | null>} результат
 */
async function resolveBaseRef() {
  for (const name of BASE_BRANCH_CANDIDATES) {
    for (const ref of [name, `origin/${name}`]) {
      const out = await gitOrNull(['rev-parse', '--verify', '--quiet', ref])
      if (typeof out === 'string' && out.trim().length > 0) {
        return ref
      }
    }
  }
  return null
}

/**
 * @param {string} baseRef параметр
 * @returns {Promise<string | null>} результат
 */
async function resolveMergeBase(baseRef) {
  const out = await gitOrNull(['merge-base', baseRef, 'HEAD'])
  if (typeof out !== 'string') return null
  const sha = out.trim()
  return sha.length > 0 ? sha : null
}

/**
 * @param {string} ws параметр
 * @param {string[]} subWorkspaces параметр
 * @returns {string[]} результат
 */
function pathspecForWorkspace(ws, subWorkspaces) {
  if (ws !== '.') return [`${ws}/`]
  return ['.', ...subWorkspaces.filter(s => s !== '.').map(s => `:(exclude)${s}/`)]
}

/**
 * @param {string} baseRef параметр
 * @param {string[]} pathspec параметр
 * @returns {Promise<string[]>} результат
 */
async function listChangedPathsAgainstBase(baseRef, pathspec) {
  /**
  @type {string[]}
   */
  const out = []
  const diffArgs =
    baseRef === 'HEAD'
      ? ['diff', '--name-only', 'HEAD', '--', ...pathspec]
      : ['diff', '--name-only', baseRef, '--', ...pathspec]
  const diffOut = await gitOrNull(diffArgs)
  if (typeof diffOut === 'string' && diffOut.trim().length > 0) {
    out.push(...diffOut.trim().split('\n'))
  }
  const untrackedOut = await gitOrNull(['ls-files', '--others', '--exclude-standard', '--', ...pathspec])
  if (typeof untrackedOut === 'string' && untrackedOut.trim().length > 0) {
    out.push(...untrackedOut.trim().split('\n'))
  }
  return [...new Set(out)]
}

/**
 * @param {string} baseRef параметр
 * @param {string} ws параметр
 * @param {string[]} subWorkspaces параметр
 * @returns {Promise<boolean>} результат
 */
async function workspaceHasRelevantChangesAgainstBase(baseRef, ws, subWorkspaces) {
  const pathspec = pathspecForWorkspace(ws, subWorkspaces)
  const paths = await listChangedPathsAgainstBase(baseRef, pathspec)
  for (const p of paths) {
    if (isChangelogIgnoredPath(p)) {
      continue
    }
    if (await isPathGitIgnored(p)) {
      continue
    }
    return true
  }
  return false
}

/**
 * Версія з маніфесту на `baseRef`.
 * @param {string} baseRef параметр
 * @param {import('../../../../scripts/utils/package-manifest.mjs').PackageManifest} manifest параметр
 * @returns {Promise<string | null>} результат
 */
async function readBaseVersion(baseRef, manifest) {
  const wsPath = manifest.ws === '.' ? manifest.manifestRel : `${manifest.ws}/${manifest.manifestRel}`
  const out = await gitOrNull(['show', `${baseRef}:${wsPath}`])
  if (out === null) return null
  if (manifest.kind === 'npm') {
    try {
      const parsed = JSON.parse(out)
      return typeof parsed?.version === 'string' ? parsed.version : null
    } catch {
      return null
    }
  }
  return parsePyprojectFields(out).version
}

/**
 * @param {string} text параметр
 * @param {string} version параметр
 * @returns {boolean} результат
 */
function changelogHasVersionEntry(text, version) {
  const needle = `## [${version}]`
  return text.startsWith(needle) || text.includes(`\n${needle}`)
}

/**
 * @param {string} name параметр
 * @returns {Promise<string | null>} результат
 */
async function defaultGetPublishedNpmVersion(name) {
  try {
    const { stdout } = await execFileAsync('npm', ['view', name, 'version'], { timeout: REGISTRY_TIMEOUT_MS })
    const v = stdout.trim()
    return v.length > 0 ? v : null
  } catch {
    return null
  }
}

/**
 * @param {string} name параметр
 * @returns {Promise<string | null>} результат
 */
async function defaultGetPublishedPyPiVersion(name) {
  try {
    const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, {
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS)
    })
    if (!res.ok) return null
    const data = await res.json()
    const v = data?.info?.version
    return typeof v === 'string' && v.length > 0 ? v : null
  } catch {
    return null
  }
}

/**
 * @param {import('../../../../scripts/utils/package-manifest.mjs').PackageManifest} manifest параметр
 * @param {(name: string, kind?: import('../../../../scripts/utils/package-manifest.mjs').PackageKind) => Promise<string | null>} getPublishedVersion параметр
 * @returns {Promise<string | null>} результат
 */
function resolvePublishedVersion(manifest, getPublishedVersion) {
  if (!manifest.name) return Promise.resolve(null)
  return getPublishedVersion(manifest.name, manifest.kind)
}

/**
 * @param {string} name пакет
 * @param {import('../../../../scripts/utils/package-manifest.mjs').PackageKind} [kind] тип пакета
 * @returns {Promise<string | null>} опублікована версія або null
 */
function defaultGetPublishedVersion(name, kind = 'npm') {
  if (kind === 'python') {
    return defaultGetPublishedPyPiVersion(name)
  }
  return defaultGetPublishedNpmVersion(name)
}

/**
 * @returns {(name: string, kind?: import('../../../../scripts/utils/package-manifest.mjs').PackageKind) => Promise<string | null>} стандартний резолвер
 */
function createDefaultGetPublishedVersion() {
  return defaultGetPublishedVersion
}

/**
 * @param {import('../../../../scripts/utils/package-manifest.mjs').PackageManifest} manifest параметр
 * @param {(msg: string) => void} pass параметр
 * @param {(msg: string) => void} fail параметр
 */
function checkNpmFilesArrayContainsChangelog(manifest, pass, fail) {
  if (manifest.kind !== 'npm' || !manifest.npmFiles) return
  const pkgPath = manifestFilePath(manifest.ws, manifest)
  if (manifest.npmFiles.includes('CHANGELOG.md')) {
    pass(`${pkgPath}: files містить "CHANGELOG.md"`)
  } else {
    fail(`${pkgPath}: масив files має містити "CHANGELOG.md", щоб публікувати changelog із пакетом`)
  }
}

/**
 * @param {string} ws параметр
 * @param {string} version параметр
 * @param {(msg: string) => void} pass параметр
 * @param {(msg: string) => void} fail параметр
 * @returns {Promise<boolean>} результат
 */
async function verifyChangelogEntry(ws, version, pass, fail) {
  const label = ws === '.' ? '<root>' : ws
  const changelogPath = join(ws, 'CHANGELOG.md')
  if (!existsSync(changelogPath)) {
    fail(`${label}: відсутній ${changelogPath} (Keep a Changelog, див. n-changelog.mdc)`)
    return false
  }
  const text = await readFile(changelogPath, 'utf8')
  if (changelogHasVersionEntry(text, version)) {
    pass(`${changelogPath}: знайдено запис для версії ${version}`)
    return true
  }
  fail(`${changelogPath}: відсутній запис для ${version} (формат "## [${version}] - YYYY-MM-DD")`)
  return false
}

/**
 * @param {import('../../../../scripts/utils/package-manifest.mjs').PackageManifest} manifest параметр
 * @returns {string} результат
 */
function workspaceLabel(manifest) {
  return manifest.ws === '.' ? '<root>' : manifest.ws
}

/**
 * @param {import('../../../../scripts/utils/package-manifest.mjs').PackageManifest} manifest параметр
 * @param {string} Vcurrent параметр
 * @param {string[]} subWorkspaces параметр
 * @param {(msg: string) => void} pass параметр
 * @param {(msg: string) => void} fail параметр
 * @returns {Promise<void>} результат
 */
async function checkPublishedWorkspacePendingGitChanges(manifest, Vcurrent, subWorkspaces, pass, fail) {
  const label = workspaceLabel(manifest)
  const mf = manifestFilePath(manifest.ws, manifest)
  if (!(await isInsideGitRepo())) {
    return
  }

  const branch = await currentBranchName()
  if (isIntegrationBranch(branch)) {
    if (await workspaceHasRelevantChangesAgainstBase('HEAD', manifest.ws, subWorkspaces)) {
      fail(
        `${label}: у registry-published пакеті є незакомічені зміни при version ${Vcurrent}, що вже в реєстрі. ` +
          `Підвищ version у ${mf} і додай запис у CHANGELOG.md (n-changelog.mdc)`
      )
    }
    return
  }

  const baseRef = await resolveBaseRef()
  if (!baseRef) {
    return
  }
  const mergeBase = await resolveMergeBase(baseRef)
  if (!mergeBase) {
    return
  }
  if (!(await workspaceHasRelevantChangesAgainstBase(mergeBase, manifest.ws, subWorkspaces))) {
    return
  }

  const Vbase = await readBaseVersion(mergeBase, manifest)
  const baseLabel = baseRefLabel(baseRef)
  if (Vbase === null || Vbase === Vcurrent) {
    fail(
      `${label}: у цій гілці є зміни в registry-published пакеті, але version у ${mf} ` +
        `не підвищено (на ${baseLabel} — ${Vbase ?? '∅'}). Bump + запис у CHANGELOG.md обов'язкові на PR (n-changelog.mdc)`
    )
    return
  }
  pass(`${label}: version змінено (${Vbase} → ${Vcurrent}) — очікується запис CHANGELOG після bump`)
}

/**
 * @param {import('../../../../scripts/utils/package-manifest.mjs').PackageManifest} manifest параметр
 * @param {string[]} subWorkspaces параметр
 * @param {(name: string, kind?: import('../../../../scripts/utils/package-manifest.mjs').PackageKind) => Promise<string | null>} getPublishedVersion параметр
 * @param {(msg: string) => void} pass параметр
 * @param {(msg: string) => void} fail параметр
 * @returns {Promise<void>} результат
 */
async function checkPublishedWorkspace(manifest, subWorkspaces, getPublishedVersion, pass, fail) {
  const label = workspaceLabel(manifest)
  const mf = manifestFilePath(manifest.ws, manifest)
  const Vcurrent = manifest.version
  if (!Vcurrent) {
    fail(`${label}: у ${mf} відсутнє поле version (registry-published воркспейс)`)
    return
  }
  const name = manifest.name
  if (!name) {
    fail(`${label}: у ${mf} відсутнє ім'я пакета (registry-published воркспейс)`)
    return
  }
  const Vpublished = await resolvePublishedVersion(manifest, getPublishedVersion)
  if (Vpublished === null) {
    pass(`${label}: ${name} — опублікована версія недоступна (мережа/реєстр), перевірку пропущено`)
    return
  }
  if (Vpublished === Vcurrent) {
    pass(`${label}: ${name}@${Vcurrent} збігається з реєстром — перевіряємо git на незрелізні зміни`)
    await checkPublishedWorkspacePendingGitChanges(manifest, Vcurrent, subWorkspaces, pass, fail)
    return
  }
  pass(`${label}: ${name} — нова локальна версія (${Vpublished} → ${Vcurrent})`)
  await verifyChangelogEntry(manifest.ws, Vcurrent, pass, fail)
  checkNpmFilesArrayContainsChangelog(manifest, pass, fail)
}

/**
 * @param {string} mergeBase параметр
 * @param {import('../../../../scripts/utils/package-manifest.mjs').PackageManifest} manifest параметр
 * @param {string} baseLabel параметр
 * @param {(msg: string) => void} pass параметр
 * @param {(msg: string) => void} fail параметр
 */
async function checkLocalOnlyChangedWorkspace(mergeBase, manifest, baseLabel, pass, fail) {
  const label = workspaceLabel(manifest)
  const mf = manifestFilePath(manifest.ws, manifest)
  const Vcurrent = manifest.version
  if (!Vcurrent) {
    fail(`${label}: у ${mf} відсутнє поле version (потрібне для запису в CHANGELOG)`)
    return
  }
  const Vbase = await readBaseVersion(mergeBase, manifest)
  if (Vbase === null || Vbase === Vcurrent) {
    fail(
      `${label}: у цій гілці є зміни, але version у ${mf} не підвищено (на ${baseLabel} — ${Vbase ?? '∅'}). Bump + запис у CHANGELOG.md обов'язкові на PR`
    )
    return
  }
  pass(`${label}: version підвищено (${Vbase} → ${Vcurrent})`)
  if (!(await verifyChangelogEntry(manifest.ws, Vcurrent, pass, fail))) return
  checkNpmFilesArrayContainsChangelog(manifest, pass, fail)
}

/**
 * @param {import('../../../../scripts/utils/package-manifest.mjs').PackageManifest[]} localOnly параметр
 * @param {string[]} subWorkspaces параметр
 * @param {(msg: string) => void} pass параметр
 * @param {(msg: string) => void} fail параметр
 */
async function runLocalOnlyChecks(localOnly, subWorkspaces, pass, fail) {
  if (localOnly.length === 0) return

  if (!(await isInsideGitRepo())) {
    pass('changelog: не git-репозиторій — local-only перевірку пропущено')
    return
  }
  const branch = await currentBranchName()
  if (branch === 'dev') {
    pass('changelog: поточна гілка = dev — local-only перевірку пропущено')
    return
  }
  const baseRef = await resolveBaseRef()
  if (!baseRef) {
    pass('changelog: ref dev/main (та origin/*) не знайдено — local-only перевірку пропущено')
    return
  }
  const mergeBase = await resolveMergeBase(baseRef)
  if (!mergeBase) {
    pass(`changelog: merge-base з ${baseRef} не знайдено — local-only перевірку пропущено`)
    return
  }

  const baseLabel = baseRefLabel(baseRef)
  let checkedAny = false
  for (const manifest of localOnly) {
    if (!(await workspaceHasRelevantChangesAgainstBase(mergeBase, manifest.ws, subWorkspaces))) continue
    checkedAny = true
    await checkLocalOnlyChangedWorkspace(mergeBase, manifest, baseLabel, pass, fail)
  }
  if (!checkedAny) {
    pass(`changelog: local-only воркспейси без змін відносно merge-base(${baseRef})`)
  }
}

/**
 * @param {object} [opts] опції перевірки
 * @param {(name: string, kind?: import('../../../../scripts/utils/package-manifest.mjs').PackageKind) => Promise<string | null>} [opts.getPublishedVersion] перевизначення npm/PyPI у тестах
 * @returns {Promise<number>} exit-код перевірки
 */
export async function check(opts = {}) {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter
  const getPublishedVersion = opts.getPublishedVersion ?? createDefaultGetPublishedVersion()

  const workspaces = await getMonorepoProjectRootDirs(process.cwd())
  const subWorkspaces = workspaces.filter(w => w !== '.')

  /**
  @type {import('../../../../scripts/utils/package-manifest.mjs').PackageManifest[]}
   */
  const published = []
  /**
  @type {import('../../../../scripts/utils/package-manifest.mjs').PackageManifest[]}
   */
  const localOnly = []

  for (const ws of workspaces) {
    const manifest = await readPackageManifest(ws)
    if (!manifest) {
      continue
    }
    if (manifest.registryPublishable) {
      published.push(manifest)
    } else {
      localOnly.push(manifest)
    }
  }

  for (const manifest of published) {
    await checkPublishedWorkspace(manifest, subWorkspaces, getPublishedVersion, pass, fail)
  }

  await runLocalOnlyChecks(localOnly, subWorkspaces, pass, fail)

  return reporter.getExitCode()
}
