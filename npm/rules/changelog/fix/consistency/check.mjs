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
 * 2) **local-only** (приватні npm, без `files`, Python без імені/версії для реєстру):
 *    feature-гілка — `merge-base` з `dev`, інакше з `main`; на `main` — diff від
 *    `origin/main` (попередній опублікований main) або `HEAD~1` без remote.
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

/** Кандидати інтеграційної гілки для feature-гілок (перша наявна; див. n-changelog.mdc). */
const FEATURE_BASE_BRANCH_CANDIDATES = Object.freeze(['dev', 'main'])

/** Гілка `dev`: local-only не активний (крім незакомічених registry-published). */
const LOCAL_ONLY_SKIP_BRANCH = 'dev'

/**
 * Префікси шляхів (posix), які не вважаються релізними змінами — інверсія glob (n-changelog.mdc):
 * документація (`docs/`, `doc/`) та синхронізований із `@nitra/cursor` інструментарій
 * (`.cursor/` — канонічні правила й скіли, `.claude/` — ADR-хуки). Останнє — дзеркало tooling-пакета,
 * не логіка самого воркспейсу, тож bump CHANGELOG не потрібен. Джерело правил у репо `@nitra/cursor`
 * лежить під `npm/`, тож на нього ця інверсія не поширюється.
 */
const CHANGELOG_IGNORE_PATH_PREFIXES = Object.freeze(['docs/', 'doc/', '.cursor/', '.claude/'])

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
 * @param {string} ref параметр
 * @returns {string} результат
 */
function baseRefLabel(ref) {
  return ref.startsWith('origin/') ? ref.slice('origin/'.length) : ref
}

/**
 * @param {string} ancestor предок
 * @param {string} descendant нащадок
 * @returns {Promise<boolean>} результат
 */
async function isGitAncestor(ancestor, descendant) {
  const out = await gitOrNull(['merge-base', '--is-ancestor', ancestor, descendant])
  return typeof out === 'string' && out.trim() === 'true'
}

/**
 * @param {string} branchName локальна або remote-tracking гілка
 * @returns {Promise<string | null>} ref для git або null
 */
async function resolveBranchRef(branchName) {
  for (const ref of [branchName, `origin/${branchName}`]) {
    const out = await gitOrNull(['rev-parse', '--verify', '--quiet', ref])
    if (typeof out === 'string' && out.trim().length > 0) {
      return ref
    }
  }
  return null
}

/**
 * @param {string} relPath параметр
 * @returns {boolean} результат
 */
function isChangelogIgnoredPath(relPath) {
  const p = relPath.replaceAll('\\', '/').replace(LEADING_DOTSLASH_RE, '')
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
 * Точка порівняння git для changelog (ref або SHA для `git diff` / `git show`).
 * @param {string | null} branch поточна гілка
 * @returns {Promise<{ ref: string, label: string } | null>} результат
 */
async function resolveChangelogComparisonPoint(branch) {
  if (branch === LOCAL_ONLY_SKIP_BRANCH) {
    return null
  }

  if (branch === 'main') {
    const originMainRaw = await gitOrNull(['rev-parse', '--verify', '--quiet', 'origin/main'])
    const originMainSha = originMainRaw?.trim()
    const headRaw = await gitOrNull(['rev-parse', 'HEAD'])
    const headSha = headRaw?.trim()
    if (originMainSha && headSha && (originMainSha === headSha || (await isGitAncestor('origin/main', 'HEAD')))) {
      return { ref: 'origin/main', label: 'main' }
    }
    const parent = await gitOrNull(['rev-parse', '--verify', '--quiet', 'HEAD~1'])
    if (typeof parent === 'string' && parent.trim().length > 0) {
      return { ref: parent.trim(), label: 'main~1' }
    }
    return null
  }

  for (const name of FEATURE_BASE_BRANCH_CANDIDATES) {
    const baseRef = await resolveBranchRef(name)
    if (!baseRef) {
      continue
    }
    const mergeBase = await resolveMergeBase(baseRef)
    if (!mergeBase) {
      continue
    }
    return { ref: mergeBase, label: baseRefLabel(baseRef) }
  }
  return null
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
 * Шляхи з `NUL`-розділеного виводу git (прапорець `-z`).
 *
 * `-z` критичний: без нього git застосовує `core.quotePath` і повертає не-ASCII імена файлів
 * (кирилиця тощо) у C-quoted формі `"docs/\320\262..."`. Такий рядок не збігається з
 * префіксами інверсії (`docs/`, `.cursor/`, ...), тож файл хибно вважався б зміною, що потребує bump.
 * @param {string | null} nulSeparated сирий вивід git або `null`
 * @returns {string[]} шляхи без обгортки/escape
 */
function splitNulPaths(nulSeparated) {
  if (typeof nulSeparated !== 'string') {
    return []
  }
  return nulSeparated.split('\0').filter(p => p.length > 0)
}

/**
 * @param {string} baseRef параметр
 * @param {string[]} pathspec параметр
 * @returns {Promise<string[]>} результат
 */
async function listChangedPathsAgainstBase(baseRef, pathspec) {
  const diffOut = await gitOrNull(['diff', '--name-only', '-z', baseRef, '--', ...pathspec])
  const untrackedOut = await gitOrNull(['ls-files', '--others', '--exclude-standard', '-z', '--', ...pathspec])
  return [...new Set([...splitNulPaths(diffOut), ...splitNulPaths(untrackedOut)])]
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

  if (branch === LOCAL_ONLY_SKIP_BRANCH) {
    if (await workspaceHasRelevantChangesAgainstBase('HEAD', manifest.ws, subWorkspaces)) {
      fail(
        `${label}: у registry-published пакеті є незакомічені зміни при version ${Vcurrent}, що вже в реєстрі. ` +
          `Підвищ version у ${mf} і додай запис у CHANGELOG.md (n-changelog.mdc)`
      )
    }
    return
  }

  const comparison = await resolveChangelogComparisonPoint(branch)
  if (comparison && (await workspaceHasRelevantChangesAgainstBase(comparison.ref, manifest.ws, subWorkspaces))) {
    const Vbase = await readBaseVersion(comparison.ref, manifest)
    const baseLabel = comparison.label
    if (Vbase === null) {
      pass(
        `${label}: новий registry-published воркспейс (на ${baseLabel} відсутній ${mf}) — перевіряємо CHANGELOG для ${Vcurrent}`
      )
      await verifyChangelogEntry(manifest.ws, Vcurrent, pass, fail)
      checkNpmFilesArrayContainsChangelog(manifest, pass, fail)
    } else if (Vbase === Vcurrent) {
      fail(
        `${label}: у цій гілці є зміни в registry-published пакеті, але version у ${mf} ` +
          `не підвищено (на ${baseLabel} — ${Vbase}). Bump + запис у CHANGELOG.md обов'язкові (n-changelog.mdc)`
      )
    } else {
      pass(`${label}: version змінено (${Vbase} → ${Vcurrent}) — очікується запис CHANGELOG після bump`)
    }
  }

  if (branch === 'main' && (await workspaceHasRelevantChangesAgainstBase('HEAD', manifest.ws, subWorkspaces))) {
    fail(
      `${label}: у registry-published пакеті є незакомічені зміни при version ${Vcurrent}, що вже в реєстрі. ` +
        `Підвищ version у ${mf} і додай запис у CHANGELOG.md (n-changelog.mdc)`
    )
  }
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
 * @param {string} comparisonRef ref/SHA для `git diff` / `git show`
 * @param {import('../../../../scripts/utils/package-manifest.mjs').PackageManifest} manifest параметр
 * @param {string} baseLabel параметр
 * @param {(msg: string) => void} pass параметр
 * @param {(msg: string) => void} fail параметр
 */
async function checkLocalOnlyChangedWorkspace(comparisonRef, manifest, baseLabel, pass, fail) {
  const label = workspaceLabel(manifest)
  const mf = manifestFilePath(manifest.ws, manifest)
  const Vcurrent = manifest.version
  if (!Vcurrent) {
    fail(`${label}: у ${mf} відсутнє поле version (потрібне для запису в CHANGELOG)`)
    return
  }
  const Vbase = await readBaseVersion(comparisonRef, manifest)
  if (Vbase === null) {
    pass(`${label}: новий воркспейс (на ${baseLabel} відсутній ${mf}) — перевіряємо CHANGELOG для ${Vcurrent}`)
    if (!(await verifyChangelogEntry(manifest.ws, Vcurrent, pass, fail))) return
    checkNpmFilesArrayContainsChangelog(manifest, pass, fail)
    return
  }
  if (Vbase === Vcurrent) {
    fail(
      `${label}: у цій гілці є зміни, але version у ${mf} не підвищено (на ${baseLabel} — ${Vbase}). Bump + запис у CHANGELOG.md обов'язкові на PR`
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
  if (branch === LOCAL_ONLY_SKIP_BRANCH) {
    pass('changelog: поточна гілка = dev — local-only перевірку пропущено')
    return
  }
  const comparison = await resolveChangelogComparisonPoint(branch)
  if (!comparison) {
    pass('changelog: ref dev/main (та origin/*) не знайдено — local-only перевірку пропущено')
    return
  }

  let checkedAny = false
  for (const manifest of localOnly) {
    if (!(await workspaceHasRelevantChangesAgainstBase(comparison.ref, manifest.ws, subWorkspaces))) continue
    checkedAny = true
    await checkLocalOnlyChangedWorkspace(comparison.ref, manifest, comparison.label, pass, fail)
  }
  if (!checkedAny) {
    pass(`changelog: local-only воркспейси без змін відносно ${comparison.label}`)
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
  // Корінь монорепо (`.` за наявності підпакетів) — це glue/конфіг/tooling, а не логіка
  // продукту: власного CHANGELOG він не веде, помітні зміни документують підпакети.
  const isMonorepoRoot = subWorkspaces.length > 0

  /**
  @type {import('../../../../scripts/utils/package-manifest.mjs').PackageManifest[]}
   */
  const published = []
  /**
  @type {import('../../../../scripts/utils/package-manifest.mjs').PackageManifest[]}
   */
  const localOnly = []

  for (const ws of workspaces) {
    if (ws === '.' && isMonorepoRoot) {
      pass(
        '<root>: корінь монорепо (glue/конфіг/tooling) — перевірку CHANGELOG пропущено; помітні зміни документують підпакети'
      )
      continue
    }
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
