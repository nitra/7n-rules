/**
 * docgen scanner — детермінований обхід проєкту для скілу `docgen`.
 *
 * Друкує JSON-список кодових файлів із відносними `sourcePath`/`docPath`
 * (тека `docs/` поряд із джерелом). Рішення про overwrite/skip приймає скіл —
 * scanner лише лістить і ставить прапор `exists`. LLM/мережі тут немає: уся
 * генерація доки — у субагентах скілу.
 */
// eslint-disable-next-line unicorn/import-style
import path from 'node:path'
import { existsSync, readdirSync, statSync } from 'node:fs'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { isDocgenIgnored } from './docgen-ignore.mjs'

/** Кодові розширення, для яких генеруємо документацію. */
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.vue', '.py'])

/** `*.test.*`, `*.spec.*` — тести, документувати не треба. */
const TEST_FILE_RE = /\.(?:test|spec)\.[^.]+$/u

/**
 * Чи корінь має system-wide docs layout.
 * Такий корінь зарезервований під репозиторні docs/adr, docs/explanation тощо,
 * тому file-level docs у нього не пишемо.
 * @param {string} root абсолютний корінь обходу
 * @returns {boolean} true — корінь system-wide docs
 */
function isSystemWideDocsRoot(root) {
  return existsSync(path.join(root, 'docs', 'adr')) || existsSync(path.join(root, 'docs', 'explanation'))
}

/**
 * Чи є файл кодовим джерелом для документування.
 * @param {string} fileName базове ім'я файлу
 * @returns {boolean} true — документуємо; false — пропускаємо
 */
export function isSourceFile(fileName) {
  if (fileName.endsWith('.d.ts')) return false
  if (TEST_FILE_RE.test(fileName)) return false
  return SOURCE_EXTENSIONS.has(path.extname(fileName))
}

/**
 * Обчислює шлях md-документа для кодового файлу: тека `docs/` поряд із джерелом.
 * Якщо `sourcePath` відносний, `docPath` теж відносний; якщо абсолютний — абсолютний.
 * @param {string} sourcePath шлях до джерела (відносний або абсолютний)
 * @returns {string} шлях до `<dir>/docs/<stem>.md` у тому ж просторі шляхів
 */
export function docPathForSource(sourcePath) {
  const dir = path.dirname(sourcePath)
  const stem = path.basename(sourcePath, path.extname(sourcePath))
  return path.join(dir, 'docs', `${stem}.md`)
}

/**
 * Рекурсивно обходить дерево від `root`, повертає кодові файли для документування.
 * Синхронний `readdirSync` — детермінований порядок і простий рекурсивний обхід без
 * гонок; обсяг дерева проєкту це дозволяє.
 * @param {string} root абсолютний корінь обходу
 * @returns {Array<{sourcePath:string, docPath:string, exists:boolean}>} список кандидатів з відносними шляхами
 */
export function scanForDocgen(root) {
  const results = []

  /**
   * @param {string} dir поточний каталог обходу
   */
  function walk(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relPath = path.relative(root, fullPath)
      if (entry.isDirectory()) {
        if (isDocgenIgnored(relPath, 'dir')) continue
        walk(fullPath)
      } else if (entry.isFile() && isSourceFile(entry.name)) {
        if (isSystemWideDocsRoot(root) && path.dirname(relPath) === '.') continue
        const sourcePath = relPath.split(path.sep).join('/')
        if (isDocgenIgnored(sourcePath)) continue
        const docPath = docPathForSource(sourcePath)
        results.push({
          sourcePath,
          docPath,
          exists: existsSync(path.join(root, docPath))
        })
      }
    }
  }

  walk(root)
  return results
}

/**
 * Стабільний slug модуля з його відносного шляху (для лейблів/логів).
 * @param {string} root абсолютний корінь обходу
 * @param {string} moduleRoot абсолютний корінь модуля
 * @returns {string} slug: `npm/rules/adr` → `npm-rules-adr`, корінь → `root`
 */
export function slugForModule(root, moduleRoot) {
  const rel = path.relative(root, moduleRoot)
  // корінь репо: фіксований sentinel 'root'
  if (rel === '') return 'root'
  return rel
    .split(path.sep)
    .join('-')
    .replaceAll(/[^\w-]+/gu, '-')
}

/**
 * Знаходить корені модулів — теки з `package.json` (корінь завжди модуль).
 * Ті ж ignore-glob правила, тож `package.json` у службових деревах не враховується.
 * @param {string} root абсолютний корінь обходу
 * @returns {string[]} абсолютні шляхи коренів модулів
 */
export function findModuleRoots(root) {
  const roots = [root]

  /** @param {string} dir поточний каталог обходу */
  function walk(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const relPath = path.relative(root, fullPath)
      if (entry.isDirectory()) {
        if (isDocgenIgnored(relPath, 'dir')) continue
        walk(fullPath)
      } else if (entry.isFile() && entry.name === 'package.json' && dir !== root) {
        roots.push(dir)
      }
    }
  }

  walk(root)
  return roots
}

/**
 * Найближчий модуль-предок для файлу (найдовший збіг шляху).
 * @param {string} filePath абсолютний шлях до файлу
 * @param {string[]} moduleRoots абсолютні корені модулів
 * @returns {string|null} абсолютний корінь модуля або null
 */
export function nearestModuleRoot(filePath, moduleRoots) {
  let best = null
  for (const moduleRoot of moduleRoots) {
    const rel = path.relative(moduleRoot, filePath)
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue
    if (best === null || moduleRoot.length > best.length) best = moduleRoot
  }
  return best
}

/**
 * Лістить логічні модулі проєкту з членами-файлами і docPath module-summary.
 * Модулі без кодових файлів пропускаються.
 * @param {string} root абсолютний корінь обходу
 * @returns {Array<{moduleRoot:string, relRoot:string, slug:string, docPath:string, members:string[], exists:boolean}>} модулі (members — sourcePath-и, відносні від root)
 */
export function scanForModules(root) {
  const files = scanForDocgen(root)
  const moduleRoots = findModuleRoots(root)
  const byRoot = new Map()
  for (const file of files) {
    const moduleRoot = nearestModuleRoot(path.join(root, file.sourcePath), moduleRoots)
    if (moduleRoot === null) continue
    if (!byRoot.has(moduleRoot)) byRoot.set(moduleRoot, [])
    byRoot.get(moduleRoot).push(file.sourcePath)
  }

  const results = []
  for (const moduleRoot of moduleRoots) {
    const members = byRoot.get(moduleRoot)
    if (!members || members.length === 0) continue
    const docPath = path.join(moduleRoot, 'docs', 'ARCHITECTURE.md')
    results.push({
      moduleRoot,
      relRoot: path.relative(root, moduleRoot) || '.',
      slug: slugForModule(root, moduleRoot),
      docPath,
      members: members.toSorted(),
      exists: existsSync(docPath)
    })
  }
  return results
}

/**
 * Парсить `--root <dir>` з argv; default — cwd.
 * @param {string[]} argv аргументи після підкоманди
 * @returns {string} абсолютний корінь
 */
export function resolveRoot(argv) {
  const i = argv.indexOf('--root')
  return i !== -1 && argv[i + 1] ? path.resolve(argv[i + 1]) : process.cwd()
}

/**
 * Парсить `--root <dir>` (default — cwd), сканує і друкує JSON-масив у stdout.
 * @param {string[]} argv аргументи після назви субкоманди (наприклад ['--root', '<dir>'])
 * @returns {Promise<number>} exit-код: 0 — успіх, 1 — корінь не існує
 */
export async function runDocgenScanCli(argv) {
  const root = resolveRoot(argv)

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`docgen scan: корінь не існує або не є директорією: ${root}`)
    return 1
  }

  const items = await scanForDocgen(root)
  console.log(JSON.stringify(items, null, 2))
  return 0
}

/**
 * Парсить `--root`, сканує модулі і друкує JSON-масив у stdout.
 * @param {string[]} argv аргументи після назви субкоманди (наприклад ['--root', '<dir>'])
 * @returns {Promise<number>} exit-код: 0 — успіх, 1 — корінь не існує
 */
export async function runDocgenModulesCli(argv) {
  const root = resolveRoot(argv)

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`docgen modules: корінь не існує або не є директорією: ${root}`)
    return 1
  }

  const items = await scanForModules(root)
  console.log(JSON.stringify(items, null, 2))
  return 0
}

if (isRunAsCli(import.meta.url)) {
  // Прямий запуск: `node skills/docgen/js/docgen-scan.mjs --root <dir>`
  process.exitCode = await runDocgenScanCli(process.argv.slice(2))
}
