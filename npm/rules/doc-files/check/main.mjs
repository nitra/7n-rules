/**
 * lint-поверхня doc-files: детект застарілих файлових документацій (per-file, з reverse-mapом).
 */
import { join, dirname, basename, extname, relative } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'

import { describeFile, isDocCandidate, isSourceFile, scanForDocFiles, scanOrphanedDocs } from '../docgen-scan/main.mjs'
import { unavailableDocFilesPlugins } from '../docgen-scan/lang-extensions.mjs'
import { buildTestEvidenceIndex, isDocgenTestFile, sourceFilesForTest } from '../docgen-test-context/main.mjs'

const DOC_MD_RE = /(?:^|\/)docs\/[^/]+\.md$/u

/**
 * Знаходить вихідний файл, якому належить доку.
 * @param {string} cwd робочий каталог
 * @param {string} docRel відносний шлях до .md-доки
 * @returns {string|null} відносний шлях джерела або null
 */
function sourceForDoc(cwd, docRel) {
  const docsDir = dirname(docRel)
  const srcDir = dirname(docsDir)
  const stem = basename(docRel, '.md')
  let entries
  try {
    entries = readdirSync(join(cwd, srcDir), { withFileTypes: true })
  } catch {
    return null
  }
  for (const e of entries) {
    if (!e.isFile() || !isSourceFile(e.name, cwd)) continue
    if (basename(e.name, extname(e.name)) !== stem) continue
    const rel = srcDir === '.' ? e.name : `${srcDir}/${e.name}`
    if (isDocCandidate(cwd, rel)) return rel
  }
  return null
}

/**
 * Зводить перелік змінених файлів до множини вихідних кодових файлів.
 * @param {string[]} files змінені шляхи (джерела або .md-доки)
 * @param {string} cwd робочий каталог
 * @param {ReturnType<typeof buildTestEvidenceIndex>} testIndex source↔tests index
 * @returns {string[]} відносні шляхи джерел
 */
function sourcesFromChanged(files, cwd, testIndex) {
  const out = new Set()
  for (const raw of files) {
    const rel = raw.split('\\').join('/')
    if (DOC_MD_RE.test(rel)) {
      const src = sourceForDoc(cwd, rel)
      if (src) out.add(src)
    } else if (isDocgenTestFile(basename(rel))) {
      for (const sourceAbs of sourceFilesForTest(join(cwd, rel), testIndex)) {
        const sourceRel = relative(cwd, sourceAbs).split('\\').join('/')
        if (isDocCandidate(cwd, sourceRel)) out.add(sourceRel)
      }
    } else if (isDocCandidate(cwd, rel) && existsSync(join(cwd, rel))) {
      out.add(rel)
    }
  }
  return [...out]
}

/**
 * @param {string[]|undefined} files змінені шляхи; undefined → повний скан
 * @param {string} cwd робочий каталог
 * @returns {Array<{ sourcePath: string, docPath?: string, reason: string }>} застарілі доки
 */
export function collectStale(files, cwd) {
  if (files === undefined) return scanForDocFiles(cwd).filter(f => f.stale)
  const testIndex = buildTestEvidenceIndex(cwd)
  const sources = sourcesFromChanged(files, cwd, testIndex)
  return sources.map(src => describeFile(cwd, src, testIndex)).filter(f => f.stale)
}

/**
 * Detector doc-files: застарілі (CRC-mismatch/missing/degraded) і сирітські файлові доки.
 * Read-only — генерація/очистка у fix-worker.mjs (docgen), не тут.
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {import('../../../scripts/lib/lint-surface/types.mjs').LintResult} перелік порушень
 */
export function lint(ctx) {
  const { cwd, files } = ctx
  /** @type {import('../../../scripts/lib/lint-surface/types.mjs').LintViolation[]} */
  const violations = []

  for (const f of collectStale(files, cwd)) {
    violations.push(
      /** @type {Partial<import('../../../scripts/lib/lint-surface/types.mjs').LintViolation>} */ ({
        reason: f.reason || 'stale',
        message: `документація застаріла/відсутня для ${f.sourcePath} (${f.reason})`,
        file: f.sourcePath,
        data: f.docPath ? { docPath: f.docPath } : undefined
      })
    )
  }
  // Явний files-набір (hook/--path) не містить межі дерева для безпечного
  // orphan-скану. Повний скан тут порушив би scope і міг би видалити доки поза
  // сервісом, тому orphan-cleanup лишається лише repo-wide прогоном.
  if (files === undefined) {
    for (const orphan of scanOrphanedDocs(cwd)) {
      violations.push(
        /** @type {Partial<import('../../../scripts/lib/lint-surface/types.mjs').LintViolation>} */ ({
          reason: 'orphaned-doc',
          message: `сирітський док (source видалено): ${orphan}`,
          file: orphan
        })
      )
    }
  }

  const unavailable = unavailableDocFilesPlugins(cwd)
  if (unavailable.length === 0) return { violations }

  const word = unavailable.length > 1 ? 'плагіни' : 'плагін'
  const verb = unavailable.length > 1 ? 'не встановлені' : 'не встановлений'
  const message = `doc-files: 0 кандидатів через недоступні плагіни — ${word} ${unavailable.join(', ')} ${verb} у node_modules — запусти bun install`
  return { violations, diagnostics: [{ level: 'warn', message }] }
}
