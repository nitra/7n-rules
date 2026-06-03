/**
 * Авто-встановлення зовнішніх CLI-залежностей пакету `@nitra/cursor`.
 *
 * `ensureTool(toolId)` — єдиний seam резолву зовнішніх бінарників: PATH → кеш → авто-install → hard-fail.
 * Новий тул = один запис у реєстрі `TOOLS`, без дублювання install-логіки в кожному `lint.mjs`/`fix.mjs`.
 *
 * Per-platform matrix: macOS → brew, Windows → scoop (fallback: GitHub Release), Linux → GitHub Release binary.
 * Бінарники кешуються у `~/.cache/@nitra/cursor/bin/` (Linux/Mac), `%LOCALAPPDATA%\@nitra\cursor\bin\` (Win).
 *
 * `ensureHkInstall(hkBin)` — реєструє git pre-commit hook через `hk install`; пропускається в CI.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { arch, env, platform } from 'node:process'

import { resolveCmd } from '../utils/resolve-cmd.mjs'

/**
 * Повертає каталог керованого кешу бінарників для поточного OS.
 * @returns {string} абсолютний шлях
 */
function getCacheDir() {
  if (platform === 'win32') {
    const localAppData = env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local')
    return join(localAppData, '@nitra', 'cursor', 'bin')
  }
  return join(homedir(), '.cache', '@nitra', 'cursor', 'bin')
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
 * @property {((ver: string) => string)|null} [binFinder] для архівів де бінарник не у корені; повертає відносний шлях
 */

/** @type {Record<string, ToolEntry>} */
const TOOLS = {
  hk: {
    brew: 'hk',
    scoop: 'hk',
    github: 'jdx/hk',
    archStyle: 'hk',
    asset: ver => `hk-${mapArch(arch, 'hk')}-unknown-linux-gnu.tar.gz`,
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
    asset: ver => `dotenv-linter-linux-${mapArch(arch, 'hk')}.tar.gz`,
    binFinder: null
  }
}

/**
 * Отримує останній тег з GitHub Releases API через curl (sync).
 * @param {string} repo репо у форматі `owner/repo`
 * @param {string} curlBin абсолютний шлях до curl
 * @returns {string} рядок версії без префікса `v`, наприклад `0.4.1`
 */
function fetchLatestVersion(repo, curlBin) {
  const url = `https://api.github.com/repos/${repo}/releases/latest`
  const r = spawnSync(curlBin, ['-sSL', '-H', 'Accept: application/vnd.github+json', url], { encoding: 'utf8' })
  if (r.error) throw new Error(`curl failed: ${r.error.message}`)
  if (r.status !== 0) throw new Error(`curl exit ${r.status}: ${(r.stderr ?? '').slice(0, 300)}`)
  let parsed
  try {
    parsed = JSON.parse(r.stdout)
  } catch {
    throw new Error(`GitHub API response is not JSON: ${r.stdout.slice(0, 200)}`)
  }
  const tag = parsed['tag_name']
  if (!tag) throw new Error(`GitHub API: tag_name missing for ${repo}`)
  return tag.replace(/^v/, '')
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
  const archivePath = join(cacheDir, assetName)

  const dlResult = spawnSync(curlBin, ['-sSL', '-o', archivePath, downloadUrl], { encoding: 'utf8' })
  if (dlResult.error) throw new Error(`Завантаження ${toolId} не вдалось: ${dlResult.error.message}`)
  if (dlResult.status !== 0)
    throw new Error(`curl exit ${dlResult.status} при завантаженні ${toolId}: ${(dlResult.stderr ?? '').slice(0, 300)}`)

  // .tar.xz потребує -J замість -z
  const isXz = assetName.endsWith('.tar.xz')
  const tarFlags = isXz ? ['-xJf'] : ['-xzf']
  const extractResult = spawnSync(tarBin, [...tarFlags, archivePath, '-C', cacheDir], { encoding: 'utf8' })
  if (extractResult.error) throw new Error(`tar failed for ${toolId}: ${extractResult.error.message}`)
  if (extractResult.status !== 0)
    throw new Error(`tar exit ${extractResult.status} для ${toolId}: ${(extractResult.stderr ?? '').slice(0, 300)}`)

  const binRelPath = entry.binFinder ? entry.binFinder(ver) : toolId
  const binPath = join(cacheDir, binRelPath)
  if (!existsSync(binPath)) {
    throw new Error(`Бінарник ${toolId} не знайдено після розпакування: ${binPath}`)
  }

  const rmBin = resolveCmd('rm')
  if (rmBin) spawnSync(rmBin, [archivePath])

  return binPath
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
 * @param {string} toolId ключ у реєстрі TOOLS (`'hk'`, `'conftest'`, `'shellcheck'`, `'actionlint'`, `'dotenv-linter'`)
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
