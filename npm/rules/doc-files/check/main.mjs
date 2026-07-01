/**
 * lint-поверхня doc-files: детект застарілих файлових документацій (per-file, з reverse-mapом).
 */
import { join, dirname, basename, extname } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'

import { describeFile, isDocCandidate, isSourceFile, scanForDocFiles, scanOrphanedDocs } from '../docgen-scan/main.mjs'

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
    if (!e.isFile() || !isSourceFile(e.name)) continue
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
 * @returns {string[]} відносні шляхи джерел
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
 * @param {string[]|undefined} files змінені шляхи; undefined → повний скан
 * @param {string} cwd робочий каталог
 * @returns {Array<{ sourcePath: string, docPath?: string, reason: string }>} застарілі доки
 */
export function collectStale(files, cwd) {
  if (files === undefined) return scanForDocFiles(cwd).filter(f => f.stale)
  const sources = sourcesFromChanged(files, cwd)
  return sources.map(src => describeFile(cwd, src)).filter(f => f.stale)
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
      /** @type {any} */ ({
        reason: f.reason || 'stale',
        message: `документація застаріла/відсутня для ${f.sourcePath} (${f.reason})`,
        file: f.sourcePath,
        data: f.docPath ? { docPath: f.docPath } : undefined
      })
    )
  }
  for (const orphan of scanOrphanedDocs(cwd)) {
    violations.push(
      /** @type {any} */ ({
        reason: 'orphaned-doc',
        message: `сирітський док (source видалено): ${orphan}`,
        file: orphan
      })
    )
  }

  return { violations }
}
