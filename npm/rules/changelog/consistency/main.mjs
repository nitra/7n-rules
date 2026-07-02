/** @see ./docs/consistency.md */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import {
  getMonorepoProjectRootDirs,
  manifestFilePath,
  parsePyprojectFields,
  readPackageManifest
} from '../lib/package-manifest.mjs'
import { writeChange } from '../../release/change.mjs'
import { readChangeFiles } from '../../release/lib/change-file.mjs'

const execFileAsync = promisify(execFile)

/** Env-прапорець, що вмикає autofix (виставляється кроком `npm-changelog` у `hk.pkl`). */
const AUTOFIX_ENV_VAR = 'N_CURSOR_CHANGELOG_AUTOFIX'

/** Дефолтний `bump` для autofix-створеного change-файлу (вищий bump редагуєш вручну). */
const AUTOFIX_BUMP = 'patch'

/** Дефолтна секція для autofix-створеного change-файлу. */
const AUTOFIX_SECTION = 'Changed'

/** Fallback-опис, коли subject останнього коміту порожній (напр. порожній репозиторій). */
const AUTOFIX_FALLBACK_MESSAGE = 'оновлення'

/** Кандидати інтеграційними тести гілки для feature-гілок (перша наявна; див. n-changelog.mdc). */
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
 * Тихо запускає `git` у заданому `cwd` і повертає stdout або `null` при будь-якій помилці.
 * @param {string[]} args аргументи `git`
 * @param {string} cwd робочий каталог процесу
 * @returns {Promise<string | null>} результат
 */
async function gitOrNull(args, cwd) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd })
    return stdout
  } catch {
    return null
  }
}

/**
 * @param {string} cwd робочий каталог
 * @returns {Promise<boolean>} результат
 */
async function isInsideGitRepo(cwd) {
  const out = await gitOrNull(['rev-parse', '--is-inside-work-tree'], cwd)
  return typeof out === 'string' && out.trim() === 'true'
}

/**
 * @param {string} cwd робочий каталог
 * @returns {Promise<string | null>} результат
 */
async function currentBranchName(cwd) {
  const out = await gitOrNull(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  return typeof out === 'string' ? out.trim() : null
}

/**
 * Чи HEAD — merge-коміт (має 2-го предка). Merge інтегрує вже задокументовану роботу
 * (changeset створено в feature-комітах), тож власного changeset не потребує — інакше
 * autofix створив би шумний «Merge…» changeset, який CI commit-back каскадить у patch-реліз.
 * @param {string} cwd робочий каталог
 * @returns {Promise<boolean>} true, якщо HEAD — merge-коміт (має 2-го предка).
 */
async function isMergeCommit(cwd) {
  const out = await gitOrNull(['rev-parse', '--verify', '--quiet', 'HEAD^2'], cwd)
  return typeof out === 'string' && out.trim().length > 0
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
 * @param {string} cwd робочий каталог
 * @returns {Promise<boolean>} результат
 */
async function isGitAncestor(ancestor, descendant, cwd) {
  const out = await gitOrNull(['merge-base', '--is-ancestor', ancestor, descendant], cwd)
  return typeof out === 'string' && out.trim() === 'true'
}

/**
 * @param {string} branchName локальна або remote-tracking гілка
 * @param {string} cwd робочий каталог
 * @returns {Promise<string | null>} ref для git або null
 */
async function resolveBranchRef(branchName, cwd) {
  for (const ref of [branchName, `origin/${branchName}`]) {
    const out = await gitOrNull(['rev-parse', '--verify', '--quiet', ref], cwd)
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
 * @param {string} cwd робочий каталог
 * @returns {Promise<boolean>} результат
 */
async function isPathGitIgnored(relPath, cwd) {
  try {
    await execFileAsync('git', ['check-ignore', '-q', '--', relPath], { cwd })
    return true
  } catch {
    return false
  }
}

/**
 * @param {string} baseRef параметр
 * @param {string} cwd робочий каталог
 * @returns {Promise<string | null>} результат
 */
async function resolveMergeBase(baseRef, cwd) {
  const out = await gitOrNull(['merge-base', baseRef, 'HEAD'], cwd)
  if (typeof out !== 'string') return null
  const sha = out.trim()
  return sha.length > 0 ? sha : null
}

/**
 * Точка порівняння git для changelog (ref або SHA для `git diff` / `git show`).
 * @param {string | null} branch поточна гілка
 * @param {string} cwd робочий каталог
 * @returns {Promise<{ ref: string, label: string } | null>} результат
 */
async function resolveChangelogComparisonPoint(branch, cwd) {
  if (branch === LOCAL_ONLY_SKIP_BRANCH) {
    return null
  }

  if (branch === 'main') {
    const originMainRaw = await gitOrNull(['rev-parse', '--verify', '--quiet', 'origin/main'], cwd)
    const originMainSha = originMainRaw?.trim()
    const headRaw = await gitOrNull(['rev-parse', 'HEAD'], cwd)
    const headSha = headRaw?.trim()
    if (originMainSha && headSha && (originMainSha === headSha || (await isGitAncestor('origin/main', 'HEAD', cwd)))) {
      return { ref: 'origin/main', label: 'main' }
    }
    const parent = await gitOrNull(['rev-parse', '--verify', '--quiet', 'HEAD~1'], cwd)
    if (typeof parent === 'string' && parent.trim().length > 0) {
      return { ref: parent.trim(), label: 'main~1' }
    }
    return null
  }

  for (const name of FEATURE_BASE_BRANCH_CANDIDATES) {
    const baseRef = await resolveBranchRef(name, cwd)
    if (!baseRef) {
      continue
    }
    const mergeBase = await resolveMergeBase(baseRef, cwd)
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
 * @param {string} cwd робочий каталог
 * @returns {Promise<string[]>} результат
 */
async function listChangedPathsAgainstBase(baseRef, pathspec, cwd) {
  const diffOut = await gitOrNull(['diff', '--name-only', '-z', baseRef, '--', ...pathspec], cwd)
  const untrackedOut = await gitOrNull(['ls-files', '--others', '--exclude-standard', '-z', '--', ...pathspec], cwd)
  return [...new Set([...splitNulPaths(diffOut), ...splitNulPaths(untrackedOut)])]
}

/**
 * @param {string} baseRef параметр
 * @param {string} ws параметр
 * @param {string[]} subWorkspaces параметр
 * @param {string} cwd робочий каталог
 * @returns {Promise<boolean>} результат
 */
async function workspaceHasRelevantChangesAgainstBase(baseRef, ws, subWorkspaces, cwd) {
  const pathspec = pathspecForWorkspace(ws, subWorkspaces)
  const paths = await listChangedPathsAgainstBase(baseRef, pathspec, cwd)
  for (const p of paths) {
    if (isChangelogIgnoredPath(p)) {
      continue
    }
    if (await isPathGitIgnored(p, cwd)) {
      continue
    }
    return true
  }
  return false
}

/**
 * Версія з маніфесту на `baseRef`.
 * @param {string} baseRef параметр
 * @param {import('../lib/package-manifest.mjs').PackageManifest} manifest параметр
 * @param {string} cwd робочий каталог
 * @returns {Promise<string | null>} результат
 */
async function readBaseVersion(baseRef, manifest, cwd) {
  const wsPath = manifest.ws === '.' ? manifest.manifestRel : `${manifest.ws}/${manifest.manifestRel}`
  const out = await gitOrNull(['show', `${baseRef}:${wsPath}`], cwd)
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
 * @param {import('../lib/package-manifest.mjs').PackageManifest} manifest параметр
 * @param {(name: string, kind?: import('../lib/package-manifest.mjs').PackageKind) => Promise<string | null>} getPublishedVersion параметр
 * @returns {Promise<string | null>} результат
 */
function resolvePublishedVersion(manifest, getPublishedVersion) {
  if (!manifest.name) return Promise.resolve(null)
  return getPublishedVersion(manifest.name, manifest.kind)
}

/** Числове ядро semver (`x.y.z`); хвіст (prerelease/build) ігнорується. */
const SEMVER_CORE_RE = /^(\d+)\.(\d+)\.(\d+)/

/**
 * Парсить числове ядро semver-рядка.
 * @param {unknown} v версія
 * @returns {{ major: number, minor: number, patch: number } | null} ядро або null
 */
function parseSemverCore(v) {
  const m = typeof v === 'string' ? v.match(SEMVER_CORE_RE) : null
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

/**
 * Порівнює semver-ядра двох версій.
 * @param {unknown} a перша версія
 * @param {unknown} b друга версія
 * @returns {-1 | 0 | 1 | null} a<b → -1, a==b → 0, a>b → 1; null — нерозпізнано
 */
function compareSemverCore(a, b) {
  const pa = parseSemverCore(a)
  const pb = parseSemverCore(b)
  if (!pa || !pb) return null
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1
  return 0
}

/**
 * Чи `current` випереджає `base` (ручний bump поза CI). Якщо semver нерозпізнаний
 * (null) — fail-closed на будь-яку нерівність (консервативно, як до directional-фікса).
 * @param {unknown} current версія в дереві
 * @param {unknown} base база (опублікована / git-база)
 * @returns {boolean} true — current попереду base (або нерозпізнано й не рівні)
 */
function versionIsAhead(current, base) {
  const cmp = compareSemverCore(current, base)
  return cmp === null ? current !== base : cmp > 0
}

/**
 * @param {string} name пакет
 * @param {import('../lib/package-manifest.mjs').PackageKind} [kind] тип пакета
 * @returns {Promise<string | null>} опублікована версія або null
 */
function defaultGetPublishedVersion(name, kind = 'npm') {
  if (kind === 'python') {
    return defaultGetPublishedPyPiVersion(name)
  }
  return defaultGetPublishedNpmVersion(name)
}

/**
 * @returns {(name: string, kind?: import('../lib/package-manifest.mjs').PackageKind) => Promise<string | null>} стандартний резолвер
 */
function createDefaultGetPublishedVersion() {
  return defaultGetPublishedVersion
}

/**
 * @param {import('../lib/package-manifest.mjs').PackageManifest} manifest параметр
 * @param {(msg: string) => void} pass параметр
 * @param {(msg: string) => void} fail параметр
 */
/**
 * Перевіряє наявність `CHANGELOG.md` у воркспейсі.
 * @param {string} ws відносний шлях воркспейсу від кореня репо
 * @param {string} label мітка для повідомлень
 * @param {string} cwd корінь репозиторію
 * @param {(msg: string) => void} pass колбек успішної перевірки.
 * @param {(msg: string) => void} fail колбек провалу перевірки.
 * @returns {boolean} true — файл існує
 */
function checkChangelogFileExists(ws, label, cwd, pass, fail) {
  const path = join(cwd, ws, 'CHANGELOG.md')
  if (existsSync(path)) {
    pass(`${label}: CHANGELOG.md існує`)
    return true
  }
  fail(`${label}: CHANGELOG.md відсутній — створи файл за форматом Keep a Changelog (n-changelog.mdc)`)
  return false
}

/**
 * Перевіряє базовий формат `CHANGELOG.md`: наявність H1 `# Changelog`.
 * Версійні секції `## [x.y.z]` не вимагаються для нових workspace-ів без релізів.
 * @param {string} ws відносний шлях воркспейсу від кореня репо
 * @param {string} label мітка для повідомлень
 * @param {string} cwd корінь репозиторію
 * @param {(msg: string) => void} pass колбек успішної перевірки.
 * @param {(msg: string) => void} fail колбек провалу перевірки.
 * @returns {Promise<void>}
 */
async function checkChangelogFormat(ws, label, cwd, pass, fail) {
  const path = join(cwd, ws, 'CHANGELOG.md')
  const content = await readFile(path, 'utf8')
  const hasH1 = content.split('\n').some(l => l.trimEnd() === '# Changelog')
  if (hasH1) {
    pass(`${label}: CHANGELOG.md має рядок "# Changelog"`)
  } else {
    fail(`${label}: CHANGELOG.md не має рядка "# Changelog" — перший рядок має бути H1-заголовком (n-changelog.mdc)`)
  }
}

/**
 * Перевіряє, що масив `files` npm-маніфесту містить `CHANGELOG.md`.
 * @param {object} manifest дескриптор воркспейсу (з kind/npmFiles).
 * @param {(msg: string) => void} pass колбек успішної перевірки.
 * @param {(msg: string) => void} fail колбек провалу перевірки.
 * @returns {void}
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
 * @param {import('../lib/package-manifest.mjs').PackageManifest} manifest параметр
 * @returns {string} результат
 */
function workspaceLabel(manifest) {
  return manifest.ws === '.' ? '<root>' : manifest.ws
}

/**
 * Повідомлення «поклади change-файл» для workspace з релевантними змінами без change-файлу.
 * @param {string} label мітка воркспейсу
 * @param {string} mf шлях до маніфесту
 * @returns {string} текст fail
 */
function missingChangeFileMessage(label, mf) {
  return (
    `${label}: є релевантні зміни, але немає change-файлу (version у ${mf} не чіпай вручну). ` +
    `Поклади change-файл: npx @7n/n ch [--bump <major|minor|patch>] [--section <Added|Changed|Fixed|Removed>] [--message "<…>"]; ` +
    `bump зробить CI на main (n-changelog.mdc)`
  )
}

/**
 * Чи має workspace незрелізні change-файли (намір зафіксовано — bump зробить CI).
 * @param {string} ws workspace
 * @param {string} cwd корінь
 * @returns {Promise<boolean>} результат
 */
async function hasPendingChangeFiles(ws, cwd) {
  const files = await readChangeFiles(ws, cwd)
  return files.length > 0
}

/**
 * Опис для autofix-change-файлу: subject останнього коміту (HEAD), а якщо порожній
 * (порожній репозиторій / detached без імені) — назва гілки, інакше fallback-літерал.
 * Опис мусить бути непорожнім — `writeChange`/`parseChangeFile` кидають на порожньому.
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<string>} непорожній опис зміни
 */
async function resolveAutoChangeMessage(cwd) {
  const lastSubject = await gitOrNull(['log', '-1', '--format=%s'], cwd)
  const subject = lastSubject?.trim()
  if (subject) return subject
  const branch = await currentBranchName(cwd)
  return branch && branch !== 'HEAD' ? branch : AUTOFIX_FALLBACK_MESSAGE
}

/**
 * Реакція на відсутній change-файл: у autofix-режимі — створити його з дефолтами й
 * поставити у git-індекс (щоб коміт не падав); інакше — fail із підказкою.
 * @param {string} ws workspace (`.` — корінь)
 * @param {string} label мітка воркспейсу для повідомлень
 * @param {string} mf шлях до маніфесту (для fail-підказки)
 * @param {boolean} autofix чи створювати файл автоматично
 * @param {(msg: string) => void} pass репортер pass
 * @param {(msg: string) => void} fail репортер fail
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<boolean>} `true` — change-файл створено (autofix); `false` — зафейлено
 */
async function reportOrFixMissingChangeFile(ws, label, mf, autofix, pass, fail, cwd) {
  if (!autofix) {
    fail(missingChangeFileMessage(label, mf))
    return false
  }
  const message = await resolveAutoChangeMessage(cwd)
  const relFromWs = await writeChange({ bump: AUTOFIX_BUMP, section: AUTOFIX_SECTION, message, ws, cwd })
  const created = ws === '.' ? relFromWs : join(ws, relFromWs)
  // Ставимо новий файл у індекс одразу: pre-commit-хук комітить уже застейджені зміни,
  // а свіжостворений untracked-файл інакше лишився б поза комітом.
  await gitOrNull(['add', '--', created], cwd)
  pass(
    `${label}: автоматично створено change-файл ${created} ` +
      `(${AUTOFIX_BUMP}/${AUTOFIX_SECTION}: "${message}") — відредагуй за потреби; bump зробить CI (n-changelog.mdc)`
  )
  return true
}

/**
 * Published-варіант реакції на відсутній change-файл: створити/зафейлити через
 * `reportOrFixMissingChangeFile`, а коли autofix створив файл — додатково перевірити,
 * що `files` містить `CHANGELOG.md` (реліз наближається — CHANGELOG публікується з пакетом).
 * @param {import('../lib/package-manifest.mjs').PackageManifest} manifest маніфест воркспейсу
 * @param {string} label мітка воркспейсу
 * @param {string} mf шлях до маніфесту
 * @param {boolean} autofix autofix-режим
 * @param {(msg: string) => void} pass репортер pass
 * @param {(msg: string) => void} fail репортер fail
 * @param {string} cwd корінь репозиторію
 * @returns {Promise<void>} результат
 */
async function fixOrFailPublishedWorkspace(manifest, label, mf, autofix, pass, fail, cwd) {
  if (await reportOrFixMissingChangeFile(manifest.ws, label, mf, autofix, pass, fail, cwd)) {
    checkNpmFilesArrayContainsChangelog(manifest, pass, fail)
  }
}

/**
 * @param {import('../lib/package-manifest.mjs').PackageManifest} manifest параметр
 * @param {string} _Vcurrent параметр (для сумісності сигнатури; bump робить CI)
 * @param {string[]} subWorkspaces параметр
 * @param {boolean} autofix autofix-режим (створити change-файл замість fail)
 * @param {(msg: string) => void} pass параметр
 * @param {(msg: string) => void} fail параметр
 * @param {string} cwd робочий каталог
 * @returns {Promise<void>} результат
 */
async function checkPublishedWorkspacePendingGitChanges(manifest, _Vcurrent, subWorkspaces, autofix, pass, fail, cwd) {
  const label = workspaceLabel(manifest)
  const mf = manifestFilePath(manifest.ws, manifest)
  if (await hasPendingChangeFiles(manifest.ws, cwd)) {
    pass(`${label}: є change-файл(и) у .changes/ — bump зробить CI (n-changelog.mdc)`)
    // Реліз наближається → CHANGELOG має публікуватися разом із пакетом.
    checkNpmFilesArrayContainsChangelog(manifest, pass, fail)
    return
  }
  if (!(await isInsideGitRepo(cwd))) {
    return
  }

  const branch = await currentBranchName(cwd)

  if (branch === LOCAL_ONLY_SKIP_BRANCH) {
    if (await workspaceHasRelevantChangesAgainstBase('HEAD', manifest.ws, subWorkspaces, cwd)) {
      await fixOrFailPublishedWorkspace(manifest, label, mf, autofix, pass, fail, cwd)
    }
    return
  }

  const comparison = await resolveChangelogComparisonPoint(branch, cwd)
  if (comparison && (await workspaceHasRelevantChangesAgainstBase(comparison.ref, manifest.ws, subWorkspaces, cwd))) {
    await fixOrFailPublishedWorkspace(manifest, label, mf, autofix, pass, fail, cwd)
    return
  }

  if (branch === 'main' && (await workspaceHasRelevantChangesAgainstBase('HEAD', manifest.ws, subWorkspaces, cwd))) {
    await fixOrFailPublishedWorkspace(manifest, label, mf, autofix, pass, fail, cwd)
  }
}

/**
 * @param {import('../lib/package-manifest.mjs').PackageManifest} manifest параметр
 * @param {string[]} subWorkspaces параметр
 * @param {(name: string, kind?: import('../lib/package-manifest.mjs').PackageKind) => Promise<string | null>} getPublishedVersion параметр
 * @param {boolean} autofix autofix-режим (створити change-файл замість fail)
 * @param {(msg: string) => void} pass параметр
 * @param {(msg: string) => void} fail параметр
 * @param {string} cwd робочий каталог
 * @returns {Promise<void>} результат
 */
async function checkPublishedWorkspace(manifest, subWorkspaces, getPublishedVersion, autofix, pass, fail, cwd) {
  const label = workspaceLabel(manifest)
  const mf = manifestFilePath(manifest.ws, manifest)
  const changelogExists = checkChangelogFileExists(manifest.ws, label, cwd, pass, fail)
  if (changelogExists) {
    await checkChangelogFormat(manifest.ws, label, cwd, pass, fail)
  }
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
  // Autofix/hook-режим: жодної мережі. Реєстровий резолв (`npm view` / PyPI fetch) і
  // drift-перевірка vs опублікована версія пропускаються — лишається лише наявність
  // change-файлу (+ autofix) і git-diff. Ручний bump version у хуці не ловиться; його
  // далі ловить CI та ручний `fix changelog` (без env). Запит користувача: «прибери
  // npm view з хуку».
  if (autofix) {
    pass(`${label}: ${name} — autofix-режим, реєстрову перевірку version пропущено (без npm view)`)
    await checkPublishedWorkspacePendingGitChanges(manifest, Vcurrent, subWorkspaces, autofix, pass, fail, cwd)
    return
  }
  const Vpublished = await resolvePublishedVersion(manifest, getPublishedVersion)
  if (Vpublished === null) {
    pass(`${label}: ${name} — опублікована версія недоступна (мережа/реєстр), перевірку пропущено`)
    return
  }
  // Лише drift УПЕРЕД (version > опублікованої) — ручний bump поза CI; має пріоритет
  // над change-файлом (симетрично з local-only-шляхом). Версія ПОЗАДУ реєстру — локаль
  // відстала від уже опублікованого релізу, не порушення (нижче).
  if (versionIsAhead(Vcurrent, Vpublished)) {
    fail(
      `${label}: version у ${mf} (${Vcurrent}) випереджає опубліковану (${Vpublished}) — ` +
        `ручний bump поза CI заборонено. Відкоти version і поклади change-файл ` +
        `(npx @7n/n ch); bump зробить CI на main (n-changelog.mdc)`
    )
    return
  }
  if (compareSemverCore(Vcurrent, Vpublished) < 0) {
    // Локаль ПОЗАДУ реєстру: CI вже опублікував новішу версію й закомітив bump назад,
    // а ти ще не зробив `git pull`. Це не ручний bump (git не дасть запушити
    // non-fast-forward), тож коміт не блокуємо — лише вимагаємо change-файл на наявні зміни.
    pass(
      `${label}: version у ${mf} (${Vcurrent}) позаду опублікованої (${Vpublished}) — ` +
        `локаль відстала від реєстру (зроби git pull); це не ручний bump`
    )
    await checkPublishedWorkspacePendingGitChanges(manifest, Vcurrent, subWorkspaces, autofix, pass, fail, cwd)
    return
  }
  pass(`${label}: ${name}@${Vcurrent} збігається з реєстром — перевіряємо git на незрелізні зміни`)
  await checkPublishedWorkspacePendingGitChanges(manifest, Vcurrent, subWorkspaces, autofix, pass, fail, cwd)
}

/**
 * @param {string} comparisonRef ref/SHA для `git diff` / `git show`
 * @param {import('../lib/package-manifest.mjs').PackageManifest} manifest параметр
 * @param {string} baseLabel параметр
 * @param {boolean} autofix autofix-режим (створити change-файл замість fail)
 * @param {(msg: string) => void} pass параметр
 * @param {(msg: string) => void} fail параметр
 * @param {string} cwd робочий каталог
 */
async function checkLocalOnlyChangedWorkspace(comparisonRef, manifest, baseLabel, autofix, pass, fail, cwd) {
  const label = workspaceLabel(manifest)
  const mf = manifestFilePath(manifest.ws, manifest)
  const Vcurrent = manifest.version
  // Лише drift УПЕРЕД (version > бази) має пріоритет над change-файлом: ручний bump
  // заборонено навіть із change-файлом (симетрично з published-шляхом). Version позаду
  // бази (гілка відстала від base-ref) — не порушення, не блокуємо.
  const Vbase = await readBaseVersion(comparisonRef, manifest, cwd)
  if (Vbase !== null && Vcurrent !== null && versionIsAhead(Vcurrent, Vbase)) {
    fail(
      `${label}: version у ${mf} змінено поза CI (${Vbase} → ${Vcurrent}) — ручний bump заборонено (на ${baseLabel} — ${Vbase}). ` +
        `Відкоти version і поклади change-файл (npx @7n/n ch); bump зробить CI (n-changelog.mdc)`
    )
    return
  }
  if (await hasPendingChangeFiles(manifest.ws, cwd)) {
    pass(`${label}: є change-файл(и) у .changes/ — bump зробить CI (n-changelog.mdc)`)
    return
  }
  await reportOrFixMissingChangeFile(manifest.ws, label, mf, autofix, pass, fail, cwd)
}

/**
 * @param {import('../lib/package-manifest.mjs').PackageManifest[]} localOnly параметр
 * @param {string[]} subWorkspaces параметр
 * @param {boolean} autofix autofix-режим (створити change-файл замість fail)
 * @param {(msg: string) => void} pass параметр
 * @param {(msg: string) => void} fail параметр
 * @param {string} cwd робочий каталог
 */
async function runLocalOnlyChecks(localOnly, subWorkspaces, autofix, pass, fail, cwd) {
  if (localOnly.length === 0) return

  for (const manifest of localOnly) {
    const label = workspaceLabel(manifest)
    const exists = checkChangelogFileExists(manifest.ws, label, cwd, pass, fail)
    if (exists) {
      await checkChangelogFormat(manifest.ws, label, cwd, pass, fail)
    }
  }

  if (!(await isInsideGitRepo(cwd))) {
    pass('changelog: не git-репозиторій — local-only перевірку пропущено')
    return
  }
  const branch = await currentBranchName(cwd)
  if (branch === LOCAL_ONLY_SKIP_BRANCH) {
    pass('changelog: поточна гілка = dev — local-only перевірку пропущено')
    return
  }
  const comparison = await resolveChangelogComparisonPoint(branch, cwd)
  if (!comparison) {
    pass('changelog: ref dev/main (та origin/*) не знайдено — local-only перевірку пропущено')
    return
  }

  let checkedAny = false
  for (const manifest of localOnly) {
    if (!(await workspaceHasRelevantChangesAgainstBase(comparison.ref, manifest.ws, subWorkspaces, cwd))) continue
    checkedAny = true
    await checkLocalOnlyChangedWorkspace(comparison.ref, manifest, comparison.label, autofix, pass, fail, cwd)
  }
  if (!checkedAny) {
    pass(`changelog: local-only воркспейси без змін відносно ${comparison.label}`)
  }
}

/**
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінт-прогону.
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>} результат перевірки consistency changelog.
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter
  const getPublishedVersion = createDefaultGetPublishedVersion()
  const cwd = ctx.cwd

  // Merge-коміт інтегрує вже задокументовану роботу — changeset не потрібен (інакше
  // autofix створює шумний «Merge…» changeset → CI commit-back каскадить patch-реліз).
  if (await isMergeCommit(cwd)) {
    pass('HEAD — merge-коміт: changelog-перевірку пропущено (changeset документують feature-коміти)')
    return reporter.result()
  }

  const autofix = process.env[AUTOFIX_ENV_VAR] === '1'

  const workspaces = await getMonorepoProjectRootDirs(cwd)
  const subWorkspaces = workspaces.filter(w => w !== '.')
  // Корінь монорепо (`.` за наявності підпакетів) — це glue/конфіг/tooling, а не логіка
  // продукту: власного CHANGELOG він не веде, помітні зміни документують підпакети.
  const isMonorepoRoot = subWorkspaces.length > 0

  /**
  @type {import('../lib/package-manifest.mjs').PackageManifest[]}
   */
  const published = []
  /**
  @type {import('../lib/package-manifest.mjs').PackageManifest[]}
   */
  const localOnly = []

  for (const ws of workspaces) {
    if (ws === '.' && isMonorepoRoot) {
      pass(
        '<root>: корінь монорепо (glue/конфіг/tooling) — перевірку CHANGELOG пропущено; помітні зміни документують підпакети'
      )
      continue
    }
    const manifest = await readPackageManifest(ws, cwd)
    if (!manifest) {
      continue
    }
    if (manifest.registryPublishable) {
      published.push(manifest)
    } else {
      localOnly.push(manifest)
    }
  }

  // Promise.all, не послідовний for (spec docs/specs/2026-07-02-text-check-per-file-split-design.md
  // §7): кожен виклик — незалежний мережевий запит (npm view/PyPI), послідовність тут не давала
  // жодної переваги, лише сумувала worst-case timeout на кожен published workspace.
  await Promise.all(
    published.map(manifest =>
      checkPublishedWorkspace(manifest, subWorkspaces, getPublishedVersion, autofix, pass, fail, cwd)
    )
  )

  await runLocalOnlyChecks(localOnly, subWorkspaces, autofix, pass, fail, cwd)

  return reporter.result()
}
