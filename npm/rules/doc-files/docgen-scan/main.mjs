/** @see ./docs/docgen-scan.md */
import { join, dirname, basename, extname, relative, resolve, sep, posix } from 'node:path'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

import { isDocgenIgnored } from '../docgen-ignore/main.mjs'
import { parseDocFrontmatter, readDocCrc, staleness } from '../docgen-crc/main.mjs'
import { pluginDocFilesExtensions } from './lang-extensions.mjs'

/** `*.test.*`, `*.spec.*`, `*.stories.*` — тести й Storybook CSF-файли, документувати не треба. */
const TEST_FILE_RE = /\.(?:test|spec|stories)\.[^.]+$/u

/**
 * Чи корінь має system-wide docs layout.
 * Такий корінь зарезервований під репозиторні docs/adr, docs/explanation тощо,
 * тому file-level docs у нього не пишемо.
 * @param {string} root абсолютний корінь обходу
 * @returns {boolean} true — корінь system-wide docs
 */
function isSystemWideDocsRoot(root) {
  return existsSync(join(root, 'docs', 'adr')) || existsSync(join(root, 'docs', 'explanation'))
}

/**
 * Чи є файл кодовим джерелом для документування. Розширення декларують ЛИШЕ
 * активні lang-плагіни (`n-rules.contributes.docFiles.extensions` — js/mjs/ts/vue
 * дає `@7n/rules-lang-js`, .rs/.py — lang-rust/lang-python); у ядрі вбудованих
 * розширень немає (фаза 5b spec lang-plugins-extraction).
 * @param {string} fileName базове ім'я файлу
 * @param {string} root корінь репозиторію (джерело плагінних розширень)
 * @returns {boolean} true — документуємо; false — пропускаємо
 */
export function isSourceFile(fileName, root) {
  if (fileName.endsWith('.d.ts')) return false
  if (TEST_FILE_RE.test(fileName)) return false
  return extname(fileName) in pluginDocFilesExtensions(root)
}

/**
 * Обчислює шлях md-документа для кодового файлу: тека `docs/` поряд із джерелом.
 * Якщо `sourcePath` відносний, `docPath` теж відносний; якщо абсолютний — абсолютний.
 * @param {string} sourcePath шлях до джерела (відносний або абсолютний)
 * @returns {string} шлях до `<dir>/docs/<stem>.md` у тому ж просторі шляхів
 */
export function docPathForSource(sourcePath) {
  const dir = dirname(sourcePath)
  const stem = basename(sourcePath, extname(sourcePath))
  return join(dir, 'docs', `${stem}.md`)
}

/**
 * Чи кодовий файл `relPath` (posix, від кореня) підлягає документуванню:
 * правильне розширення, не тест, не в ignore-дереві, не кореневий system-wide docs.
 * @param {string} root абсолютний корінь
 * @param {string} relPath posix-шлях файлу від кореня
 * @returns {boolean} true — кандидат на доку
 */
export function isDocCandidate(root, relPath) {
  const fileName = posix.basename(relPath)
  if (!isSourceFile(fileName, root)) return false
  if (isSystemWideDocsRoot(root) && posix.dirname(relPath) === '.') return false
  return !isDocgenIgnored(relPath)
}

/**
 * Описує один кодовий файл: шлях джерела, шлях доки, стан застарілості за CRC.
 *
 * `foreign: true` — docPath існує, але БЕЗ `docgen:`-CRC у frontmatter: рукописна
 * (людська) дока. Така дока вважається чинною документацією файлу (`stale: false`) —
 * генерація її мовчки не перезаписує (перезапис лише explicit `--overwrite`, який
 * бере всі цілі без фільтра). Живий кейс: `npm/docs/index.md` — людський зміст модуля
 * у проєкті-споживачі; сканер бачив його як `missing` і затирав чат-філером моделі.
 * @param {string} root абсолютний корінь
 * @param {string} sourcePath posix-шлях джерела від кореня
 * @returns {{sourcePath:string, docPath:string, stale:boolean, reason:'missing'|'crc-mismatch'|null, foreign:boolean}} опис файлу
 */
export function describeFile(root, sourcePath) {
  const docPath = docPathForSource(sourcePath)
  const docAbsPath = join(root, docPath)
  if (existsSync(docAbsPath) && readDocCrc(docAbsPath) === null) {
    return { sourcePath, docPath, stale: false, reason: null, foreign: true }
  }
  const { stale, reason } = staleness(join(root, sourcePath), docAbsPath)
  return { sourcePath, docPath, stale, reason, foreign: false }
}

/**
 * Знаходить "сирітські" доки: `docs/<stem>.md` із `resource:` + `docgen.crc` у frontmatter,
 * у яких відповідний source-файл (resource:) вже не існує. Перевіряє лише файли,
 * згенеровані `fix-doc-files` (наявність `docgen.crc` у frontmatter). Directory Index
 * (resource із `/` на кінці) та ручні доки без `resource:` або без CRC — ігноруються.
 * @param {string} root абсолютний корінь обходу
 * @returns {string[]} posix-шляхи сирітських doc-файлів від кореня
 */
export function scanOrphanedDocs(root) {
  const orphans = []

  /** @param {string} docsAbsDir абсолютний шлях docs/-директорії */
  function scanDocsDir(docsAbsDir) {
    let entries
    try {
      entries = readdirSync(docsAbsDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const fullPath = join(docsAbsDir, entry.name)
      let content
      try {
        content = readFileSync(fullPath, 'utf8')
      } catch {
        continue
      }
      const { data } = parseDocFrontmatter(content)
      // Пропускаємо: Directory Index (resource з `/`), ручні доки (немає resource або CRC)
      if (!data?.source || data.source.endsWith('/') || !data.crc) continue
      if (!existsSync(join(root, data.source))) {
        orphans.push(relative(root, fullPath).split(sep).join('/'))
      }
    }
  }

  /**
   * Обходить дерево, шукаючи docs/-директорії для orphan-перевірки.
   *  docs/ — входимо завжди (батьківська пройшла ignore-перевірку);
   *  інші — перевіряємо через isDocgenIgnored.
   * @param {string} dir абсолютний шлях директорії для обходу.
   */
  function walk(dir) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const fullPath = join(dir, entry.name)
      if (entry.name === 'docs') {
        scanDocsDir(fullPath)
      } else {
        const relPath = relative(root, fullPath).split(sep).join('/')
        if (isDocgenIgnored(relPath, 'dir')) continue
        walk(fullPath)
      }
    }
  }

  walk(root)
  return orphans
}

/**
 * Підмножина шляхів, які git вважає ігнорованими (`.gitignore` + global excludes).
 * Один батч-виклик `git check-ignore --stdin`. Tracked-файли git не репортить як
 * ігноровані (тож `euscp.js` лишається кандидатом). Поза git-репо / коли жоден не
 * ігнорується — порожній набір (graceful: фільтр просто не застосовується).
 * @param {string} root абсолютний корінь (cwd для git)
 * @param {string[]} relPaths posix-шляхи від кореня
 * @returns {Set<string>} підмножина ігнорованих relPaths
 */
function gitIgnoredPaths(root, relPaths) {
  if (relPaths.length === 0) return new Set()
  try {
    const out = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd: root,
      input: relPaths.join('\n'),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'] // git пише «not a git repository» у stderr — глушимо
    })
    return new Set(
      out
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
    )
  } catch {
    // exit 1 (жоден не ігнорується) і 128 (не git-репо) → execFileSync кидає; обидва = «не фільтруємо».
    return new Set()
  }
}

/**
 * Рекурсивно обходить дерево від `root`, повертає кодові файли зі станом застарілості.
 * Синхронний `readdirSync` — детермінований порядок без гонок; обсяг дерева це дозволяє.
 * Поверх `DOCGEN_IGNORE_GLOBS` відсіює ще й те, що в `.gitignore` (через git check-ignore).
 * @param {string} root абсолютний корінь обходу
 * @returns {Array<{sourcePath:string, docPath:string, stale:boolean, reason:'missing'|'crc-mismatch'|null}>} кандидати з відносними шляхами
 */
export function scanForDocFiles(root) {
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
      } else if (entry.isFile() && isSourceFile(entry.name, root)) {
        if (isSystemWideDocsRoot(root) && dirname(relPath) === '.') continue
        const sourcePath = relPath.split(sep).join('/')
        if (isDocgenIgnored(sourcePath)) continue
        results.push(describeFile(root, sourcePath))
      }
    }
  }

  walk(root)
  const ignored = gitIgnoredPaths(
    root,
    results.map(r => r.sourcePath)
  )
  return ignored.size ? results.filter(r => !ignored.has(r.sourcePath)) : results
}

/**
 * Парсить `--root <dir>` з argv; default — cwd.
 * @param {string[]} argv аргументи після підкоманди
 * @returns {string} абсолютний корінь
 */
export function resolveRoot(argv) {
  const i = argv.indexOf('--root')
  return i !== -1 && argv[i + 1] ? resolve(argv[i + 1]) : process.cwd()
}
