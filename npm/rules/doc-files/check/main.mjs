/**
 * lint-поверхня doc-files: детект застарілих файлових документацій (per-file, з reverse-mapом).
 */
import { join, dirname, basename, extname } from 'node:path'
import { existsSync, readdirSync } from 'node:fs'

import { describeFile, isDocCandidate, isSourceFile, scanForDocFiles, scanOrphanedDocs } from '../docgen-scan/main.mjs'

const DOC_MD_RE = /(?:^|\/)docs\/[^/]+\.md$/u

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

function reportStale(stale) {
  if (stale.length === 0) return 0
  const list = stale.map(f => `  - ${f.sourcePath} (${f.reason})`).join('\n')
  process.stderr.write(
    `❌ doc-files: документація застаріла/відсутня для ${stale.length} файл(ів):\n${list}\n→ перегенеруй: npx @nitra/cursor fix-doc-files\n`
  )
  return 1
}

function collectStale(files, cwd) {
  if (files === undefined) return scanForDocFiles(cwd).filter(f => f.stale)
  const sources = sourcesFromChanged(files, cwd)
  return sources.map(src => describeFile(cwd, src)).filter(f => f.stale)
}

/**
 * lint-поверхня doc-files: детект/fix застарілих doc-files (per-file або full).
 * @param {string[] | undefined} files per-file або undefined (full)
 * @param {string} [cwd] корінь
 * @param {{ readOnly?: boolean, llmFix?: boolean }} [opts]
 * @returns {Promise<number>}
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

  if (stale.length > 0) {
    process.stdout.write(`ℹ️  doc-files: ${stale.length} застарілих — пробую авто-фікс (omlx)…\n`)
  }
  const { runGenerationBatch, purgeOrphanedDocs } = await import('../docgen-files-batch/main.mjs')
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
