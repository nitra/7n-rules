/**
 * Авто-встановлення зовнішніх CLI-залежностей пакету `@7n/rules`.
 *
 * `ensureTool(toolId)` — єдиний seam резолву зовнішніх бінарників: PATH → кеш → авто-install → hard-fail.
 * Новий тул = один запис у реєстрі `TOOLS`, без дублювання install-логіки в кожному `lint.mjs`/`fix.mjs`.
 *
 * Lookup останнього релізу йде через GitHub API з `GITHUB_TOKEN`/`GH_TOKEN` за наявності
 * (per-IP ліміт 60/год вичерпується на shared CI-runner-ах), з fallback-ом на redirect
 * `releases/latest` повз API; транзієнтні збої lookup/download кидаються як `ToolProvisionError`
 * (fail-open seam для lint-детекторів — див. `lint-surface/detect.mjs`).
 *
 * Per-platform matrix: macOS → brew, Windows → scoop (fallback: GitHub Release), Linux → GitHub Release binary.
 * Бінарники кешуються у `~/.cache/@7n/rules/bin/` (Linux/Mac), `%LOCALAPPDATA%\@7n\cursor\bin\` (Win).
 * Download завжди пишеться в унікальний per-call temp-каталог і публікується атомарним `renameSync` —
 * паралельні install того самого тула (різні процеси/промиси) не тупцюють по спільному archive-шляху.
 *
 * `ensureTool` лишається синхронним — публічний API пакету (`@7n/rules/scripts/lib/ensure-tool.mjs`,
 * реально споживається зовнішнім `plugins/ci-github`), сигнатуру не міняємо. `ensureToolAsync(toolId)` —
 * async-варіант для parallel lane `detectAll()`: внутрішньопроцесний single-flight + міжпроцесний
 * `withLock` навколо auto-install кроку (`docs/adr/260716-1354-…`).
 *
 * `ensureHkInstall(hkBin)` — реєструє git pre-commit hook через `hk install`; пропускається в CI.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { arch, env, platform } from 'node:process'

import { resolveCmd } from '../utils/resolve-cmd.mjs'
import { withLock } from '../utils/with-lock.mjs'

/** Префікс `v` у git-тегу релізу (`v1.2.3` → `1.2.3`). */
const TAG_V_PREFIX_RE = /^v/

/** Тег релізу з фінального URL redirect-у `releases/latest` (`…/releases/tag/v1.2.3`). */
const RELEASE_TAG_URL_RE = /\/tag\/([^/\s]+)\s*$/

/**
 * Транзієнтний збій авто-встановлення зовнішнього тула (GitHub API rate-limit, мережа,
 * обірваний download). Відрізняється від конфігураційних помилок (невідомий тул,
 * `N_CURSOR_NO_AUTO_INSTALL`, відсутній curl) — споживачі розпізнають за `name`
 * і можуть спрацювати fail-open замість валити весь прогін.
 */
export class ToolProvisionError extends Error {
  /** @param {string} message причина збою */
  constructor(message) {
    super(message)
    this.name = 'ToolProvisionError'
  }
}

/**
 * Повертає каталог керованого кешу бінарників для поточного OS.
 * @returns {string} абсолютний шлях
 */
function getCacheDir() {
  if (platform === 'win32') {
    const localAppData = env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
    return join(localAppData, '@7n', 'rules', 'bin')
  }
  return join(homedir(), '.cache', '@7n', 'rules', 'bin')
}

/**
 * Мапить `process.arch` у формат, що вживається в назвах GitHub-release ресурсів.
 * @param {'x64'|'arm64'|string} nodeArch значення `process.arch`
 * @param {'hk'|'conftest'|'actionlint'} style стиль іменування платформи
 * @returns {string} рядок архітектури для asset-шаблону
 */
function mapArch(nodeArch, style) {
  if (style === 'actionlint') {
    return nodeArch === 'x64' ? 'amd64' : 'arm64'
  }
  if (style === 'conftest') {
    return nodeArch === 'x64' ? 'x86_64' : 'arm64'
  }
  // hk / shellcheck / dotenv-linter: x64 → x86_64, arm64 → aarch64
  return nodeArch === 'x64' ? 'x86_64' : 'aarch64'
}

/**
 * @typedef {object} ToolEntry
 * @property {string} brew формула brew (macOS)
 * @property {string|null} scoop назва пакету scoop (Windows); null = недоступний
 * @property {string} github репо у форматі `owner/repo`
 * @property {(ver: string) => string} asset повертає назву release-ресурсу для Linux
 * @property {string} archStyle стиль маппінгу архітектури: 'hk'|'conftest'|'actionlint'
 * @property {boolean} [archive] чи є release-ресурс архівом (tar) — default `true`; `false` = сирий бінарник (download + chmod)
 * @property {((ver: string) => string)|null} [binFinder] для архівів де бінарник не у корені; повертає відносний шлях
 */

/** @type {Record<string, ToolEntry>} */
const TOOLS = {
  hk: {
    brew: 'hk',
    scoop: 'hk',
    github: 'jdx/hk',
    archStyle: 'hk',
    asset: _ver => `hk-${mapArch(arch, 'hk')}-unknown-linux-gnu.tar.gz`,
    binFinder: null
  },
  conftest: {
    brew: 'conftest',
    scoop: 'conftest',
    github: 'open-policy-agent/conftest',
    archStyle: 'conftest',
    asset: ver => `conftest_${ver}_Linux_${mapArch(arch, 'conftest')}.tar.gz`,
    binFinder: null
  },
  shellcheck: {
    brew: 'shellcheck',
    scoop: 'shellcheck',
    github: 'koalaman/shellcheck',
    archStyle: 'hk',
    asset: ver => `shellcheck-v${ver}.linux.${mapArch(arch, 'hk')}.tar.xz`,
    binFinder: ver => `shellcheck-v${ver}/shellcheck`
  },
  actionlint: {
    brew: 'actionlint',
    scoop: 'actionlint',
    github: 'rhysd/actionlint',
    archStyle: 'actionlint',
    asset: ver => `actionlint_${ver}_linux_${mapArch(arch, 'actionlint')}.tar.gz`,
    binFinder: null
  },
  'dotenv-linter': {
    brew: 'dotenv-linter',
    scoop: null,
    github: 'dotenv-linter/dotenv-linter',
    archStyle: 'hk',
    asset: _ver => `dotenv-linter-linux-${mapArch(arch, 'hk')}.tar.gz`,
    binFinder: null
  },
  opa: {
    brew: 'opa',
    scoop: 'opa',
    github: 'open-policy-agent/opa',
    archStyle: 'actionlint',
    archive: false,
    asset: _ver => `opa_linux_${mapArch(arch, 'actionlint')}`,
    binFinder: null
  },
  regal: {
    brew: 'regal',
    scoop: null,
    github: 'StyraInc/regal',
    archStyle: 'conftest',
    archive: false,
    asset: _ver => `regal_Linux_${mapArch(arch, 'conftest')}`,
    binFinder: null
  },
  hadolint: {
    brew: 'hadolint',
    scoop: 'hadolint',
    github: 'hadolint/hadolint',
    archStyle: 'conftest',
    archive: false,
    asset: _ver => `hadolint-linux-${mapArch(arch, 'conftest')}`,
    binFinder: null
  },
  kubeconform: {
    brew: 'kubeconform',
    scoop: 'kubeconform',
    github: 'yannh/kubeconform',
    archStyle: 'actionlint',
    asset: _ver => `kubeconform-linux-${mapArch(arch, 'actionlint')}.tar.gz`,
    binFinder: null
  },
  kubescape: {
    brew: 'kubescape',
    scoop: 'kubescape',
    github: 'kubescape/kubescape',
    archStyle: 'actionlint',
    archive: false,
    asset: ver => `kubescape_${ver}_linux_${mapArch(arch, 'actionlint')}`,
    binFinder: null
  }
}

/**
 * Заголовки авторизації GitHub для curl: `GITHUB_TOKEN`/`GH_TOKEN` з env, якщо є.
 * Токен піднімає rate-limit API з 60/год (per-IP, вичерпується на shared CI-runner-ах)
 * до 5000/год (per-token).
 * @returns {string[]} додаткові аргументи curl (порожньо без токена)
 */
function githubAuthArgs() {
  const token = env['GITHUB_TOKEN'] ?? env['GH_TOKEN']
  return token ? ['-H', `Authorization: Bearer ${token}`] : []
}

/**
 * Отримує останній тег з GitHub Releases API через curl (sync).
 * @param {string} repo репо у форматі `owner/repo`
 * @param {string} curlBin абсолютний шлях до curl
 * @returns {string} рядок версії без префікса `v`, наприклад `0.4.1`
 */
function fetchLatestVersionViaApi(repo, curlBin) {
  const url = `https://api.github.com/repos/${repo}/releases/latest`
  const args = ['-sSL', '-H', 'Accept: application/vnd.github+json', ...githubAuthArgs(), url]
  const r = spawnSync(curlBin, args, { encoding: 'utf8' })
  if (r.error) throw new Error(`curl failed: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`curl exit ${r.status}: ${(r.stderr ?? '').slice(0, 300)}`)
  let parsed
  try {
    parsed = JSON.parse(r.stdout)
  } catch {
    throw new Error(`GitHub API response is not JSON: ${r.stdout.slice(0, 200)}`)
  }
  const tag = parsed['tag_name']
  if (!tag) {
    // Без tag_name API типово повертає message («API rate limit exceeded …») — показуємо його
    const apiMessage = typeof parsed['message'] === 'string' ? ` (${parsed['message'].slice(0, 200)})` : ''
    throw new Error(`GitHub API: tag_name missing for ${repo}${apiMessage}`)
  }
  return tag.replace(TAG_V_PREFIX_RE, '')
}

/**
 * Fallback-резолюція останнього тега без API: `https://github.com/<repo>/releases/latest`
 * переадресовує на `…/releases/tag/<tag>` — читаємо тег з фінального URL (`%{url_effective}`).
 * Веб-endpoint не підпадає під API rate-limit, тож працює і на shared-runner-ах без токена.
 * @param {string} repo репо у форматі `owner/repo`
 * @param {string} curlBin абсолютний шлях до curl
 * @returns {string} рядок версії без префікса `v`
 */
function fetchLatestVersionViaRedirect(repo, curlBin) {
  const url = `https://github.com/${repo}/releases/latest`
  const r = spawnSync(curlBin, ['-sIL', '-w', '%{url_effective}', url], { encoding: 'utf8' })
  if (r.error) throw new Error(`curl failed: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`curl exit ${r.status}: ${(r.stderr ?? '').slice(0, 300)}`)
  const m = RELEASE_TAG_URL_RE.exec(r.stdout)
  if (!m) throw new Error(`releases/latest redirect без /tag/ у фінальному URL для ${repo}`)
  return m[1].replace(TAG_V_PREFIX_RE, '')
}

/**
 * Отримує останній тег релізу: спершу GitHub API (з токеном за наявності), при збої —
 * redirect-fallback повз API. Кидає `ToolProvisionError`, лише якщо не вдались обидва шляхи.
 * Експортовано для юніт-тестів; основний споживач — `installFromGithub`.
 * @param {string} repo репо у форматі `owner/repo`
 * @param {string} curlBin абсолютний шлях до curl
 * @returns {string} рядок версії без префікса `v`, наприклад `0.4.1`
 */
export function fetchLatestVersion(repo, curlBin) {
  let apiError
  try {
    return fetchLatestVersionViaApi(repo, curlBin)
  } catch (error) {
    apiError = error
  }
  try {
    return fetchLatestVersionViaRedirect(repo, curlBin)
  } catch (error) {
    throw new ToolProvisionError(
      `latest-release lookup не вдався для ${repo} — API: ${apiError.message}; redirect: ${error.message}`
    )
  }
}

/**
 * Завантажує та розпаковує GitHub Release бінарник у кеш-директорію.
 * Повертає абсолютний шлях до бінарника.
 * @param {string} toolId ключ у TOOLS
 * @param {ToolEntry} entry опис тула
 * @param {string} cacheDir абсолютний шлях до кешу
 * @returns {string} абсолютний шлях до готового бінарника
 */
function installFromGithub(toolId, entry, cacheDir) {
  const curlBin = resolveCmd('curl')
  if (!curlBin) throw new Error(`curl не знайдено в PATH — потрібен для завантаження ${toolId}`)
  const tarBin = resolveCmd('tar')
  if (!tarBin) throw new Error(`tar не знайдено в PATH — потрібен для встановлення ${toolId}`)

  const ver = fetchLatestVersion(entry.github, curlBin)
  const assetName = entry.asset(ver)
  const downloadUrl = `https://github.com/${entry.github}/releases/download/v${ver}/${assetName}`

  mkdirSync(cacheDir, { recursive: true })
  // Унікальний per-call temp-каталог у тому ж cacheDir (той самий filesystem — атомарний renameSync
  // наприкінці не впаде з EXDEV). Паралельні install-и того самого тула пишуть у різні temp-каталоги,
  // не конфліктуючи один з одним; під фіксованим `<toolId>`-іменем публікується лише готовий бінарник.
  const tmpDir = mkdtempSync(join(cacheDir, `.tmp-${toolId}-`))
  try {
    const archivePath = join(tmpDir, assetName)

    // Збої download-у — транзієнтні (мережа/GitHub), тому ToolProvisionError, як і lookup вище.
    const dlResult = spawnSync(curlBin, ['-sSL', '-o', archivePath, downloadUrl], { encoding: 'utf8' })
    if (dlResult.error) throw new ToolProvisionError(`Завантаження ${toolId} не вдалось: ${dlResult.error.message}`)
    if (dlResult.status !== 0) {
      throw new ToolProvisionError(
        `curl exit ${dlResult.status} при завантаженні ${toolId}: ${(dlResult.stderr ?? '').slice(0, 300)}`
      )
    }

    const publishedBin = join(cacheDir, toolId)

    // Сирий бінарник (archive: false) — завантажений файл і є бінарником: chmod + атомарна публікація.
    if (entry.archive === false) {
      chmodSync(archivePath, 0o755)
      renameSync(archivePath, publishedBin)
      return publishedBin
    }

    // .tar.xz потребує -J замість -z
    const isXz = assetName.endsWith('.tar.xz')
    const tarFlags = isXz ? ['-xJf'] : ['-xzf']
    const extractResult = spawnSync(tarBin, [...tarFlags, archivePath, '-C', tmpDir], { encoding: 'utf8' })
    if (extractResult.error) throw new Error(`tar failed for ${toolId}: ${extractResult.error.message}`)
    if (extractResult.status !== 0) {
      throw new Error(`tar exit ${extractResult.status} для ${toolId}: ${(extractResult.stderr ?? '').slice(0, 300)}`)
    }

    const binRelPath = entry.binFinder ? entry.binFinder(ver) : toolId
    const extractedBin = join(tmpDir, binRelPath)
    if (!existsSync(extractedBin)) {
      throw new Error(`Бінарник ${toolId} не знайдено після розпакування: ${extractedBin}`)
    }

    // Атомарна публікація під фіксованим flat-іменем — незалежно від вкладеної структури архіву
    // (напр. shellcheck розпаковується у `shellcheck-v<ver>/shellcheck`), щоб наступний виклик
    // `ensureTool` бачив кеш за тим самим шляхом, яким його перевіряє (`join(cacheDir, toolId)`).
    renameSync(extractedBin, publishedBin)
    return publishedBin
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

/**
 * Встановлює тул через brew (macOS). Hard-fail на будь-яку помилку.
 * @param {string} toolId ключ у TOOLS
 * @param {ToolEntry} entry опис тула
 * @returns {string} абсолютний шлях до встановленого бінарника
 */
function installViaBrew(toolId, entry) {
  const brewBin = resolveCmd('brew')
  if (!brewBin) throw new Error(`brew не знайдено в PATH. Встанови Homebrew: https://brew.sh`)
  const r = spawnSync(brewBin, ['install', entry.brew], { stdio: 'inherit', encoding: 'utf8' })
  if (r.error) throw new Error(`brew install ${toolId} не вдалось: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`brew install ${toolId} завершився з кодом ${r.status}`)
  const resolved = resolveCmd(toolId)
  if (!resolved) throw new Error(`${toolId} не знайдено в PATH після brew install`)
  return resolved
}

/**
 * Встановлює тул через scoop (Windows). Кидає якщо scoop недоступний або пакет null.
 * @param {string} toolId ключ у TOOLS
 * @param {ToolEntry} entry опис тула
 * @returns {string} абсолютний шлях до встановленого бінарника
 */
function installViaScoop(toolId, entry) {
  if (!entry.scoop) {
    throw new Error(`${toolId} недоступний у Scoop. Встанови вручну:\n   https://github.com/${entry.github}/releases`)
  }
  const scoopBin = resolveCmd('scoop')
  if (!scoopBin) throw new Error(`scoop не знайдено в PATH. Встанови Scoop: https://scoop.sh`)
  const r = spawnSync(scoopBin, ['install', entry.scoop], { stdio: 'inherit', encoding: 'utf8' })
  if (r.error) throw new Error(`scoop install ${toolId} не вдалось: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`scoop install ${toolId} завершився з кодом ${r.status}`)
  const resolved = resolveCmd(toolId)
  if (!resolved) throw new Error(`${toolId} не знайдено в PATH після scoop install`)
  return resolved
}

/**
 * Виконує авто-встановлення тула відповідно до поточного OS.
 * @param {string} toolId ключ у TOOLS
 * @param {ToolEntry} entry опис тула
 * @param {string} cacheDir каталог кешу для Linux-бінарників
 * @returns {string} абсолютний шлях до бінарника
 */
function autoInstall(toolId, entry, cacheDir) {
  if (platform === 'darwin') return installViaBrew(toolId, entry)
  if (platform === 'win32') {
    try {
      return installViaScoop(toolId, entry)
    } catch {
      // Scoop недоступний або тул не в Scoop → GitHub Release fallback
      return installFromGithub(toolId, entry, cacheDir)
    }
  }
  // Linux
  return installFromGithub(toolId, entry, cacheDir)
}

/**
 * Будує install-hint повідомлення для hard-fail.
 * @param {string} toolId ключ у TOOLS
 * @param {ToolEntry} entry опис тула
 * @returns {string} рядок помилки з підказками
 */
function buildHint(toolId, entry) {
  const lines = [
    `❌ ${toolId} не знайдено в PATH і авто-встановлення відключено (N_CURSOR_NO_AUTO_INSTALL).`,
    '   Встанови:'
  ]
  if (platform === 'darwin') {
    lines.push(`     macOS: brew install ${entry.brew}`)
  } else if (platform === 'win32') {
    if (entry.scoop) lines.push(`     Windows: scoop install ${entry.scoop}`)
    lines.push(`     або: https://github.com/${entry.github}/releases`)
  } else {
    lines.push(`     Linux: https://github.com/${entry.github}/releases`)
  }
  return lines.join('\n')
}

/**
 * Резолвить і за необхідності авто-встановлює зовнішній CLI-тул.
 *
 * Порядок: PATH → кеш → авто-install (якщо не N_CURSOR_NO_AUTO_INSTALL) → hard-fail.
 * Повертає абсолютний шлях або кидає Error.
 * @param {string} toolId ключ у реєстрі TOOLS (`'hk'`, `'conftest'`, `'shellcheck'`, `'actionlint'`, `'dotenv-linter'`, `'opa'`, `'regal'`, `'hadolint'`, `'kubeconform'`, `'kubescape'`)
 * @returns {string} абсолютний шлях до бінарника
 */
export function ensureTool(toolId) {
  const entry = TOOLS[toolId]
  if (!entry) throw new Error(`ensureTool: невідомий тул '${toolId}'`)

  // 1. PATH
  const fromPath = resolveCmd(toolId)
  if (fromPath) return fromPath

  // 2. Кеш
  const cacheDir = getCacheDir()
  const cachedBin = join(cacheDir, toolId)
  if (existsSync(cachedBin)) return cachedBin

  // 3. Авто-install (якщо не заблоковано)
  if (!env['N_CURSOR_NO_AUTO_INSTALL']) {
    return autoInstall(toolId, entry, cacheDir)
  }

  // 4. Hard-fail з per-OS підказкою
  throw new Error(buildHint(toolId, entry))
}

/** Внутрішньопроцесний single-flight: конкурентні `ensureToolAsync(toolId)` в одному Node-процесі колапсують в один install. */
const inFlightInstalls = new Map()

/**
 * Обгортає `autoInstall` міжпроцесним `withLock` — паралельні Node-процеси (різні CI-shard-и,
 * кілька агентів на тій самій машині) чекають у черзі замість конкурентного запису в спільний
 * cache/archive-шлях. Fingerprint-дедуп локу вимкнено (`getFingerprint: () => null`) — той
 * механізм призначений для повторних CLI-команд на тому самому git-дереві, тут важлива лише
 * взаємовиключність; після взяття локу перевіряємо кеш повторно (інший процес міг встановити,
 * поки ми чекали).
 * @param {string} toolId ключ у реєстрі TOOLS
 * @param {ToolEntry} entry опис тула
 * @param {string} cacheDir каталог кешу
 * @returns {Promise<string>} абсолютний шлях до бінарника
 */
async function installWithCrossProcessLock(toolId, entry, cacheDir) {
  let resultPath = null
  await withLock(
    `ensure-tool/${toolId}`,
    () => {
      const cachedBin = join(cacheDir, toolId)
      resultPath = existsSync(cachedBin) ? cachedBin : autoInstall(toolId, entry, cacheDir)
      return 0
    },
    { onWaitTimeout: 'fail', getFingerprint: () => null }
  )
  return resultPath
}

/**
 * Async-варіант `ensureTool` для parallel lane `detectAll()` (ADR 260716-1354). `ensureTool`
 * (sync) лишається незміненою — публічний API пакета; ця функція існує окремо, не заміняє її.
 *
 * Fast-paths (PATH, уже закешований бінарник) — ідентичні sync-версії. Auto-install — єдина
 * гілка, що реально потребує async: обгорнута internal single-flight (`inFlightInstalls`) і
 * cross-process `withLock`, щоб паралельні виклики того самого `toolId` (в одному процесі чи
 * кількох) не тягнули install конкурентно.
 * @param {string} toolId ключ у реєстрі TOOLS (`'hk'`, `'conftest'`, `'shellcheck'`, `'actionlint'`, `'dotenv-linter'`, `'opa'`, `'regal'`, `'hadolint'`, `'kubeconform'`, `'kubescape'`)
 * @returns {Promise<string>} абсолютний шлях до бінарника
 */
export async function ensureToolAsync(toolId) {
  const entry = TOOLS[toolId]
  if (!entry) throw new Error(`ensureTool: невідомий тул '${toolId}'`)

  // 1. PATH
  const fromPath = resolveCmd(toolId)
  if (fromPath) return fromPath

  // 2. Кеш
  const cacheDir = getCacheDir()
  const cachedBin = join(cacheDir, toolId)
  if (existsSync(cachedBin)) return cachedBin

  // 3. Hard-fail (opt-out) — до single-flight, щоб не ставити зайвий запис у Map даремно
  if (env['N_CURSOR_NO_AUTO_INSTALL']) throw new Error(buildHint(toolId, entry))

  // 4. Авто-install: single-flight (in-process) + withLock (cross-process)
  const inFlight = inFlightInstalls.get(toolId)
  if (inFlight) return inFlight

  const installPromise = installWithCrossProcessLock(toolId, entry, cacheDir)
  inFlightInstalls.set(toolId, installPromise)
  try {
    // Єдиний реальний await у функції: коли installPromise усталиться (для ЦЬОГО, ініціюючого
    // виклику — конкурентні виклики вище просто повернули той самий inFlight), приберемо запис
    // з Map рівно один раз, незалежно від того, скільки викликів чекало на той самий проміс.
    return await installPromise
  } finally {
    inFlightInstalls.delete(toolId)
  }
}

/**
 * Реєструє git pre-commit hook через `hk install`.
 * Пропускається в CI (`process.env.CI`). Попереджає (не кидає) на помилку.
 * @param {string} hkBin абсолютний шлях до бінарника hk
 * @returns {void}
 */
export function ensureHkInstall(hkBin) {
  if (env['CI']) return

  const r = spawnSync(hkBin, ['install'], { stdio: 'inherit', encoding: 'utf8' })
  if (r.error) {
    console.warn(`⚠️ hk install не вдалось: ${r.error.message}`)
  } else if (r.status !== 0) {
    console.warn(`⚠️ hk install завершився з кодом ${r.status}`)
  }
}
