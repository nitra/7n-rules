/** @see ./docs/lint.md */
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
 * Збирає застарілі (missing ∪ crc-mismatch) описи у scope кроку.
 * @param {string[] | undefined} files quick: лише ці файли; undefined: весь репозиторій
 * @param {string} cwd корінь репо
 * @returns {Array<{sourcePath:string, docPath:string, reason:string|null}>} stale-описи (готові як targets генерації)
 */
function collectStale(files, cwd) {
  if (files === undefined) return scanForDocFiles(cwd).filter(f => f.stale)
  const sources = sourcesFromChanged(files, cwd)
  return sources.map(src => describeFile(cwd, src)).filter(f => f.stale)
}

/**
 * Крок агрегатора lint для doc-files (opportunistic LLM-fix tier).
 * @param {string[] | undefined} files quick: лише ці файли; undefined: весь репозиторій
 * @param {string} [cwd] корінь репо
 * @param {{ readOnly?: boolean, llmFix?: boolean }} [opts] readOnly: лише детект (CI/hook);
 *   llmFix: opt-in opportunistic-генерація (з `meta.json: llmFix:true`) — без нього detect-only
 * @returns {Promise<number>} 0 — доки свіжі; 1 — є застарілі (детект, fix пропущено чи помилка генерації)
 */
export async function lint(files, cwd = process.cwd(), { readOnly = false, llmFix = false } = {}) {
  const stale = collectStale(files, cwd)
  if (stale.length === 0) return 0
  if (readOnly || !llmFix) return reportStale(stale)

  // fix-by-default: opportunistic-генерація через спільне ядро (preflight omlx →
  // батч із circuit-breaker'ом). omlx недоступний → runGenerationBatch друкує причину
  // й повертає !=0; ми re-detect'имо й через reportStale віддаємо exit 1 (гейт тримається).
  process.stdout.write(`ℹ️  doc-files: ${stale.length} застарілих — пробую авто-фікс (omlx)…\n`)
  const { runGenerationBatch } = await import('./docgen-files-batch.mjs')
  await runGenerationBatch(stale, cwd, { headline: `📋 doc-files: генерація ${stale.length} файл(ів)` })
  return reportStale(collectStale(files, cwd))
}

export { runLintDocFilesCli } from '../lint/lint.mjs'
