/** @see ./docs/docgen-scan.md */
import { join, relative, dirname, extname, sep, isAbsolute, resolve } from 'node:path'
import { existsSync, readdirSync, statSync } from 'node:fs'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { isDocgenIgnored } from './docgen-ignore.mjs'

/** Кодові розширення, для яких генеруємо документацію. */
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.vue', '.py'])

/** `*.test.*`, `*.spec.*` — тести, документувати не треба. */
const TEST_FILE_RE = /\.(?:test|spec)\.[^.]+$/u

/**
 * Чи корінь має system-wide docs layout (зарезервований під repo docs/adr тощо).
 * @param {string} root абсолютний корінь обходу
 * @returns {boolean} true — корінь system-wide docs
 */
function isSystemWideDocsRoot(root) {
  return existsSync(join(root, 'docs', 'adr')) || existsSync(join(root, 'docs', 'explanation'))
}

/**
 * Чи є файл кодовим джерелом для документування.
 * @param {string} fileName базове ім'я файлу
 * @returns {boolean} true — документуємо
 */
export function isSourceFile(fileName) {
  if (fileName.endsWith('.d.ts')) return false
  if (TEST_FILE_RE.test(fileName)) return false
  return SOURCE_EXTENSIONS.has(extname(fileName))
}

/**
 * Рекурсивно збирає кодові файли проєкту (posix-шляхи від кореня).
 * @param {string} root абсолютний корінь обходу
 * @returns {string[]} sourcePath-и
 */
export function scanSourceFiles(root) {
  const results = []

  /** @param {string} dir поточний каталог обходу */
  function walk(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const relPath = relative(root, fullPath)
      if (entry.isDirectory()) {
        if (isDocgenIgnored(relPath, 'dir')) continue
        walk(fullPath)
      } else if (entry.isFile() && isSourceFile(entry.name)) {
        if (isSystemWideDocsRoot(root) && dirname(relPath) === '.') continue
        const sourcePath = relPath.split(sep).join('/')
        if (isDocgenIgnored(sourcePath)) continue
        results.push(sourcePath)
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
  const rel = relative(root, moduleRoot)
  if (rel === '') return 'root'
  return rel
    .split(sep)
    .join('-')
    .replaceAll(/[^\w-]+/gu, '-')
}

/**
 * Знаходить корені модулів — теки з `package.json` (корінь завжди модуль).
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
      const fullPath = join(dir, entry.name)
      const relPath = relative(root, fullPath)
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
    const rel = relative(moduleRoot, filePath)
    if (rel.startsWith('..') || isAbsolute(rel)) continue
    if (best === null || moduleRoot.length > best.length) best = moduleRoot
  }
  return best
}

/**
 * Лістить логічні модулі проєкту з членами-файлами і docPath module-summary.
 * Модулі без кодових файлів пропускаються.
 * @param {string} root абсолютний корінь обходу
 * @returns {Array<{moduleRoot:string, relRoot:string, slug:string, docPath:string, members:string[], exists:boolean}>} модулі (members — sourcePath-и від root)
 */
export function scanForModules(root) {
  const files = scanSourceFiles(root)
  const moduleRoots = findModuleRoots(root)
  const byRoot = new Map()
  for (const sourcePath of files) {
    const moduleRoot = nearestModuleRoot(join(root, sourcePath), moduleRoots)
    if (moduleRoot === null) continue
    if (!byRoot.has(moduleRoot)) byRoot.set(moduleRoot, [])
    byRoot.get(moduleRoot).push(sourcePath)
  }

  const results = []
  for (const moduleRoot of moduleRoots) {
    const members = byRoot.get(moduleRoot)
    if (!members || members.length === 0) continue
    const docPath = join(moduleRoot, 'docs', 'ARCHITECTURE.md')
    results.push({
      moduleRoot,
      relRoot: relative(root, moduleRoot) || '.',
      slug: slugForModule(root, moduleRoot),
      docPath,
      members: members.toSorted(),
      exists: existsSync(docPath)
    })
  }
  return results
}

/**
 * Парсить `--root <dir>`; default — cwd.
 * @param {string[]} argv аргументи після підкоманди
 * @returns {string} абсолютний корінь
 */
export function resolveRoot(argv) {
  const i = argv.indexOf('--root')
  return i !== -1 && argv[i + 1] ? resolve(argv[i + 1]) : process.cwd()
}

/**
 * `doc-aggregate modules` — сканує модулі і друкує JSON-масив у stdout.
 * @param {string[]} argv аргументи після назви субкоманди
 * @returns {number} exit-код: 0 — успіх, 1 — корінь не існує
 */
export function runDocAggregateModulesCli(argv) {
  const root = resolveRoot(argv)
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`doc-aggregate modules: корінь не існує або не є директорією: ${root}`)
    return 1
  }
  console.log(JSON.stringify(scanForModules(root), null, 2))
  return 0
}

if (isRunAsCli(import.meta.url)) {
  // Прямий запуск: `node skills/doc-aggregate/js/docgen-scan.mjs modules --root <dir>`
  const [sub, ...rest] = process.argv.slice(2)
  process.exitCode = runDocAggregateModulesCli(sub === 'modules' ? rest : process.argv.slice(2))
}
