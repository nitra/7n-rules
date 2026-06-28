/**
 * Спеціалізований fix-worker для правила `doc-files` — замінює автономний pi-agent
 * контрольованим пайплайном: парсить stale-файли з violation-output і передає їх
 * безпосередньо в `runGenerationBatch`. Жодних зайвих `edit`/`write` поза переліком.
 *
 * Контракт worker-seam (orchestrator.mjs): повертає `{ applied, touchedFiles, error, rollback }`.
 */

import { join, relative } from 'node:path'
import { existsSync } from 'node:fs'
import { runGenerationBatch } from './docgen-files-batch.mjs'
import { scanForDocFiles } from './docgen-scan.mjs'

/**
 * Парсить stale-файли з violation-output рядка `❌ <path> (reason)`.
 * @param {string} violation вивід з `main()` lint.mjs
 * @param {string} cwd корінь проєкту
 * @returns {Array<{sourcePath:string,docPath:string,stale:boolean,reason:string}>}
 */
function parseStaleFromViolation(violation, cwd) {
  const all = scanForDocFiles(cwd)
  const mentioned = new Set()
  for (const line of violation.split('\n')) {
    const m = line.match(/❌\s+(.+?)\s+\((crc-mismatch|missing)\)/)
    if (m) mentioned.add(m[1].trim())
  }
  if (mentioned.size === 0) return all.filter(f => f.stale)
  return all.filter(f => mentioned.has(f.sourcePath))
}

/**
 * Fix-worker для `doc-files`: генерує доки тільки для файлів зі violation-списку.
 * @param {string} _ruleId 'doc-files' (ігнорується — worker вже спеціалізований)
 * @param {string} violation violation-output з ❌-рядками
 * @param {string} cwd корінь проєкту
 * @returns {Promise<{ applied: boolean, touchedFiles: string[], error: string|null, rollback: () => void }>}
 */
export async function runDocFilesFixWorker(_ruleId, violation, cwd) {
  const targets = parseStaleFromViolation(violation, cwd)
  if (targets.length === 0) {
    return { applied: false, touchedFiles: [], error: 'doc-files: жодного stale-файлу у violation', rollback: () => {} }
  }

  const touchedFiles = targets.map(f => join(cwd, f.docPath))
  const rollback = () => {}

  try {
    await runGenerationBatch(targets, cwd, { headline: `  📄 doc-files: генерація ${targets.length} доки(ів)` })
    const generated = touchedFiles.filter(p => existsSync(p))
    return { applied: generated.length > 0, touchedFiles: generated, error: null, rollback }
  } catch (e) {
    return { applied: false, touchedFiles: [], error: e.message, rollback }
  }
}
