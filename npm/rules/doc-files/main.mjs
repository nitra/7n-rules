/** @see ./docs/lint.md */
import { join, dirname, basename, extname } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'

import { describeFile, isDocCandidate, isSourceFile, scanForDocFiles, scanOrphanedDocs } from './js/docgen-scan.mjs'
import { isRunAsCli, runRuleCli } from '../../scripts/lib/run-rule-cli.mjs'
import { runStandardRule } from '../../scripts/lib/run-standard-rule.mjs'

/**
 * Єдиний entrypoint правила (ADR 2026-06-21). `run()` — check-поверхня (applies → JS-concerns
 * → policy → mdc-refs); `lint()` нижче — lint-поверхня (детект застарілих файлових док), імпл інлайн тут.
 * @param {import('../../scripts/lib/run-standard-rule.mjs').RuleContext} [ctx] контекст прогону
 * @returns {Promise<number>} 0 — OK, 1 — порушення
 */
export function run(ctx) {
  return runStandardRule(import.meta.dirname, ctx)
}

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
    `❌ doc-files: документація застаріла/відсутня для ${stale.length} файл(ів):\n${list}\n→ перегенеруй: npx @nitra/cursor fix-doc-files\n`
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
  const orphans = scanOrphanedDocs(cwd)

  if (stale.length === 0 && orphans.length === 0) return 0
  if (readOnly || !llmFix) {
    if (stale.length > 0) reportStale(stale)
    if (orphans.length > 0) {
      const list = orphans.map(f => `  - ${f}`).join('\n')
      process.stderr.write(
        `❌ doc-files: сирітських доків (source видалено) ${orphans.length}:\n${list}\n→ очисти: npx @nitra/cursor fix-doc-files\n`
      )
    }
    return 1
  }

  // fix-by-default: opportunistic-генерація stale + purge orphans.
  // omlx недоступний → runGenerationBatch друкує причину й повертає !=0;
  // purgeOrphanedDocs не залежить від LLM і виконується завжди.
  if (stale.length > 0) {
    process.stdout.write(`ℹ️  doc-files: ${stale.length} застарілих — пробую авто-фікс (omlx)…\n`)
  }
  const { runGenerationBatch, purgeOrphanedDocs } = await import('./js/docgen-files-batch.mjs')
  if (stale.length > 0) {
    await runGenerationBatch(stale, cwd, { headline: `📋 doc-files: генерація ${stale.length} файл(ів)` })
  }
  if (orphans.length > 0) {
    const deleted = purgeOrphanedDocs(cwd)
    if (deleted > 0) process.stdout.write(`🗑 doc-files: видалено ${deleted} сирітських доки(ів)\n`)
  }

  const stillStale = collectStale(files, cwd)
  const stillOrphans = scanOrphanedDocs(cwd)
  if (stillStale.length === 0 && stillOrphans.length === 0) return 0
  if (stillStale.length > 0) reportStale(stillStale)
  if (stillOrphans.length > 0) {
    const list = stillOrphans.map(f => `  - ${f}`).join('\n')
    process.stderr.write(
      `❌ doc-files: сирітських доків (source видалено) ${stillOrphans.length}:\n${list}\n→ очисти: npx @nitra/cursor fix-doc-files\n`
    )
  }
  return 1
}

export { runLintDocFilesCli } from './js/run-lint.mjs'

if (isRunAsCli(import.meta.url)) {
  // Standalone: bun rules/doc-files/main.mjs — повний еквівалент `npx @nitra/cursor check doc-files`.
  process.exitCode = await runRuleCli(import.meta.dirname)
}
