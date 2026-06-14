/**
 * Адаптер агрегатора `n-cursor lint` для правила doc-files.
 *
 * Quick-фаза отримує список змінених файлів і мапить їх у пари в **обидва** боки:
 *  - змінене **джерело** (`.js/.mjs/.ts/.vue/.py/.rs`) → перевірка його доки `<dir>/docs/<stem>.md`;
 *  - змінена/видалена **дока** (`<dir>/docs/<stem>.md`) → перевірка відповідного джерела
 *    (той самий stem у каталозі над текою `docs`).
 * Ci-фаза (files === undefined) проганяє повний скан дерева.
 *
 * Порушення — `missing` ∪ `crc-mismatch` (детермінований CRC-детект, 0 LLM-токенів);
 * degraded не блокує. Exit 1 — є stale; 0 — все свіже (конвенція агрегатора).
 */
import { join, dirname, basename, extname } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'

import { describeFile, isDocCandidate, isSourceFile, scanForDocFiles } from './docgen-scan.mjs'

/** Дока живе у `<dir>/docs/<stem>.md`; повертає `<dir>/<stem>` для реверс-мапінгу. */
const DOC_MD_RE = /(?:^|\/)docs\/[^/]+\.md$/u

/**
 * Реверс-мапінг доки → джерело: для `<dir>/docs/<stem>.md` шукає у `<dir>` файл
 * `<stem>.<ext>` із кодовим розширенням, що існує і є кандидатом на доку.
 * @param {string} cwd корінь репо
 * @param {string} docRel posix-шлях доки від кореня
 * @returns {string|null} posix-шлях джерела або null
 */
function sourceForDoc(cwd, docRel) {
  const docsDir = dirname(docRel) // `<dir>/docs`
  const srcDir = dirname(docsDir) // `<dir>`
  const stem = basename(docRel, '.md')
  let entries
  try {
    entries = readdirSync(join(cwd, srcDir), { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    if (!e.isFile() || !isSourceFile(e.name)) continue
    if (basename(e.name, extname(e.name)) !== stem) continue
    const rel = srcDir === '.' ? e.name : `${srcDir}/${e.name}`
    if (isDocCandidate(cwd, rel)) return rel
  }
  return null
}

/**
 * Зводить список змінених файлів у множину джерел-кандидатів для перевірки доки.
 * @param {string[]} files змінені шляхи (posix або нативні)
 * @param {string} cwd корінь репо
 * @returns {string[]} унікальні posix-шляхи джерел
 */
function sourcesFromChanged(files, cwd) {
  const out = new Set()
  for (const raw of files) {
    const rel = raw.split('\\').join('/')
    if (DOC_MD_RE.test(rel)) {
      const src = sourceForDoc(cwd, rel)
      if (src) out.add(src)
    } else if (isDocCandidate(cwd, rel) && existsSync(join(cwd, rel))) {
      out.add(rel)
    }
  }
  return [...out]
}

/**
 * Друкує список stale і повертає exit-код.
 * @param {Array<{sourcePath:string, reason:string|null}>} stale застарілі описи
 * @returns {number} 1 — є stale; 0 — немає
 */
function reportStale(stale) {
  if (stale.length === 0) return 0
  const list = stale.map(f => `  - ${f.sourcePath} (${f.reason})`).join('\n')
  process.stderr.write(
    `✗ doc-files: документація застаріла/відсутня для ${stale.length} файл(ів):\n${list}\n→ перегенеруй: npx @nitra/cursor fix-doc-files\n`
  )
  return 1
}

/**
 * Крок агрегатора lint для doc-files.
 * @param {string[] | undefined} files quick: лише ці файли; undefined: весь репозиторій
 * @param {string} [cwd] корінь репо
 * @returns {Promise<number>} 0 — OK, 1 — є застарілі доки
 */
export function lint(files, cwd = process.cwd()) {
  if (files === undefined) {
    const stale = scanForDocFiles(cwd).filter(f => f.stale)
    return Promise.resolve(reportStale(stale))
  }
  const sources = sourcesFromChanged(files, cwd)
  if (sources.length === 0) return Promise.resolve(0)
  const stale = sources.map(src => describeFile(cwd, src)).filter(f => f.stale)
  return Promise.resolve(reportStale(stale))
}
