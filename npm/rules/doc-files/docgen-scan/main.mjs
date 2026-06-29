/** @see ./docs/docgen-scan.md */
import { join, dirname, basename, extname, relative, resolve, sep, isAbsolute, posix } from 'node:path'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { env } from 'node:process'

import { isRunAsCli } from '../../../scripts/cli-entry.mjs'
import { isDocgenIgnored } from '../docgen-ignore/main.mjs'
import { QUALITY_THRESHOLD, parseDocFrontmatter, readDocQuality, staleness } from '../docgen-crc/main.mjs'

/** Кодові розширення, для яких генеруємо документацію. */
const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.vue', '.py', '.rs'])

/** `*.test.*`, `*.spec.*` — тести, документувати не треба. */
const TEST_FILE_RE = /\.(?:test|spec)\.[^.]+$/u

/** Поріг великого прогону для Stop-гейта: більше stale-файлів — не блокуємо. */
const DEFAULT_GATE_MAX = Number(env.N_CURSOR_DOC_FILES_GATE_MAX ?? 50) || 50

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
 * Чи є файл кодовим джерелом для документування.
 * @param {string} fileName базове ім'я файлу
 * @returns {boolean} true — документуємо; false — пропускаємо
 */
export function isSourceFile(fileName) {
  if (fileName.endsWith('.d.ts')) return false
  if (TEST_FILE_RE.test(fileName)) return false
  return SOURCE_EXTENSIONS.has(extname(fileName))
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
  if (!isSourceFile(fileName)) return false
  if (isSystemWideDocsRoot(root) && posix.dirname(relPath) === '.') return false
  return !isDocgenIgnored(relPath)
}

/**
 * Описує один кодовий файл: шлях джерела, шлях доки, стан застарілості за CRC.
 * @param {string} root абсолютний корінь
 * @param {string} sourcePath posix-шлях джерела від кореня
 * @returns {{sourcePath:string, docPath:string, stale:boolean, reason:'missing'|'crc-mismatch'|null}} опис файлу
 */
export function describeFile(root, sourcePath) {
  const docPath = docPathForSource(sourcePath)
  const { stale, reason } = staleness(join(root, sourcePath), join(root, docPath))
  return { sourcePath, docPath, stale, reason }
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
      } else if (entry.isFile() && isSourceFile(entry.name)) {
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

/**
 * Сканує дерево і друкує JSON-масив усіх кодових файлів зі станом застарілості.
 * Рішення «генерувати лише stale чи всі» приймає скіл, фільтруючи поле `stale`.
 * @param {string[]} argv аргументи після назви субкоманди
 * @returns {number} exit-код: 0 — успіх, 1 — корінь не існує
 */
export function runDocFilesScanCli(argv) {
  const root = resolveRoot(argv)
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`doc-files scan: корінь не існує або не є директорією: ${root}`)
    return 1
  }
  console.log(JSON.stringify(scanForDocFiles(root), null, 2))
  return 0
}

/**
 * Зчитує stdin до EOF як utf8 рядок. На TTY — повертає `''` одразу.
 * @returns {Promise<string>} вміст stdin
 */
async function readStdin() {
  if (process.stdin.isTTY) return ''
  process.stdin.setEncoding('utf8')
  const chunks = []
  process.stdin.on('data', chunk => chunks.push(chunk))
  try {
    await once(process.stdin, 'end')
  } catch {
    // 'error' на stdin — повертаємо те, що встигли зібрати
  }
  return chunks.join('')
}

/**
 * Дістає `tool_input.file_path` зі stdin JSON Claude Code PostToolUse hook.
 * @param {string} stdinJson сирий вміст stdin
 * @returns {string|null} відносний шлях або null
 */
function extractHookFilePath(stdinJson) {
  if (!stdinJson) return null
  try {
    const fp = JSON.parse(stdinJson)?.tool_input?.file_path
    return typeof fp === 'string' && fp !== '' ? fp : null
  } catch {
    return null
  }
}

/**
 * Список змінених у задачі джерел — найшвидший спосіб: `git diff --name-only HEAD`
 * (working-tree проти HEAD). Допускаємо неповне покриття (закомічене в межах задачі
 * випадає) — це свідомий компроміс; CRC лишається джерелом правди про застарілість.
 * @param {string} root абсолютний корінь
 * @returns {string[]} posix-шляхи кодових файлів-кандидатів, що існують
 */
function gitChangedSources(root) {
  let out
  try {
    out = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' })
  } catch {
    return []
  }
  return out
    .split('\n')
    .map(s => s.trim())
    .filter(rel => rel && isDocCandidate(root, rel) && existsSync(join(root, rel)))
}

/**
 * Нормалізує абсолютний/відносний шлях до posix-шляху від кореня (або null поза деревом).
 * @param {string} root абсолютний корінь
 * @param {string} candidate шлях-кандидат
 * @returns {string|null} posix-шлях від кореня
 */
function toRelSource(root, candidate) {
  const rel = relative(root, resolve(root, candidate))
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return rel.split(sep).join('/')
}

/**
 * `doc-files check --degraded` — інформаційний список свіжих за CRC док зі
 * `score < QUALITY_THRESHOLD` (локальний конвеєр не дотягнув; ADR 260610-2228).
 * Не блокує (exit 0): degraded — борг, що автоматично доретраюється наступним `gen`, а не гейт.
 * @param {string} root абсолютний корінь
 * @returns {number} exit-код: завжди 0
 */
function runDegradedReport(root) {
  const degraded = []
  for (const f of scanForDocFiles(root)) {
    if (f.stale) continue
    const { score, issues } = readDocQuality(join(root, f.docPath))
    if (score !== null && score < QUALITY_THRESHOLD) degraded.push({ ...f, score, issues })
  }
  if (degraded.length === 0) {
    console.log(`✓ doc-files: degraded-док немає (поріг ${QUALITY_THRESHOLD}).`)
    return 0
  }
  const list = degraded
    .map(f => {
      const issuesTxt = f.issues.length ? ': ' + f.issues.join(',') : ''
      return `  - ${f.sourcePath} (score=${f.score}${issuesTxt})`
    })
    .join('\n')
  console.log(
    `⚠ doc-files: degraded-док ${degraded.length} (score < ${QUALITY_THRESHOLD}):\n${list}\n→ доретраюються автоматично наступним \`gen\` (один раз на версію джерела).`
  )
  return 0
}

/**
 * `doc-files check` — детермінований детектор застарілості для hook'ів і CLI.
 *
 * Режими:
 * - `--hook`     — PostToolUse: бере `file_path` зі stdin JSON, перевіряє один файл.
 * - `--git`      — Stop-гейт: перевіряє `git diff --name-only HEAD`. Поріг `--max N`
 *                  (default 50): якщо stale більше — не блокуємо (exit 0 + попередження).
 * - `--degraded` — інформаційний звіт по доках зі score нижче порогу (exit 0).
 * - `<paths…>`   — явні шляхи-джерела.
 *
 * Exit 2 (стале знайдено) — для hook'а це блок/нагадування Claude; exit 0 — все свіже
 * або великий прогін понад поріг.
 * @param {string[]} argv аргументи після назви субкоманди
 * @returns {Promise<number>} exit-код (0 / 2)
 */
export async function runDocFilesCheckCli(argv) {
  const root = resolveRoot(argv)
  if (argv.includes('--degraded')) return runDegradedReport(root)
  const hookMode = argv.includes('--hook')
  const gitMode = argv.includes('--git')
  const maxIdx = argv.indexOf('--max')
  const gateMax = maxIdx !== -1 && argv[maxIdx + 1] ? Number(argv[maxIdx + 1]) || DEFAULT_GATE_MAX : DEFAULT_GATE_MAX

  let sources
  if (hookMode) {
    const fp = extractHookFilePath(await readStdin())
    const rel = fp ? toRelSource(root, fp) : null
    sources = rel && isDocCandidate(root, rel) && existsSync(join(root, rel)) ? [rel] : []
  } else if (gitMode) {
    sources = gitChangedSources(root)
  } else {
    // Значення прапорців виключаємо за індексом: порівняння за значенням при
    // відсутньому `--max` (maxIdx = -1) викидало argv[0] — перший шлях губився
    const flagValueIdxs = new Set(
      ['--max', '--root']
        .map(f => argv.indexOf(f))
        .filter(i => i !== -1)
        .map(i => i + 1)
    )
    sources = argv
      .filter((a, i) => !a.startsWith('--') && !flagValueIdxs.has(i))
      .map(a => toRelSource(root, a))
      .filter(rel => rel && isDocCandidate(root, rel) && existsSync(join(root, rel)))
  }

  const stale = sources.map(src => describeFile(root, src)).filter(f => f.stale)
  // В git-режимі (Stop-гейт) додатково шукаємо сирітські доки без source-файлу
  const orphans = gitMode ? scanOrphanedDocs(root) : []

  if (stale.length === 0 && orphans.length === 0) return 0

  // Великий прогін stale: Stop-гейт не блокує, але orphan-check продовжуємо
  if (gitMode && stale.length > gateMax) {
    console.error(
      `⚠ doc-files: застарілих док ${stale.length} (> ${gateMax}) — гейт не блокує. Запусти масовий прогін:\n  npx @nitra/cursor fix-doc-files`
    )
    if (orphans.length === 0) return 0
    const oList = orphans.map(f => `  - ${f}`).join('\n')
    console.error(
      `✗ doc-files: сирітських доків (source видалено) ${orphans.length}:\n${oList}\n→ очисти: npx @nitra/cursor fix-doc-files`
    )
    return 2
  }

  if (stale.length > 0) {
    const list = stale.map(f => `  - ${f.sourcePath} (${f.reason})`).join('\n')
    console.error(
      `✗ doc-files: документація застаріла/відсутня для ${stale.length} файл(ів):\n${list}\n→ перегенеруй: /doc-files`
    )
  }
  if (orphans.length > 0) {
    const oList = orphans.map(f => `  - ${f}`).join('\n')
    console.error(
      `✗ doc-files: сирітських доків (source видалено) ${orphans.length}:\n${oList}\n→ очисти: npx @nitra/cursor fix-doc-files`
    )
  }
  return 2
}

if (isRunAsCli(import.meta.url)) {
  // Прямий запуск: `node skills/doc-files/js/docgen-scan.mjs [scan|check] [args]`
  const [sub, ...rest] = process.argv.slice(2)
  const argv = sub === 'scan' || sub === 'check' ? rest : process.argv.slice(2)
  process.exitCode = sub === 'check' ? await runDocFilesCheckCli(argv) : runDocFilesScanCli(argv)
}
