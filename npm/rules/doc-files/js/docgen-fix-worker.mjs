/**
 * Спеціалізований fix-worker для правила `doc-files` — замінює автономний pi-agent
 * контрольованим пайплайном: парсить stale-файли з violation-output і передає їх
 * безпосередньо в `runGenerationBatch`. Жодних зайвих `edit`/`write` поза переліком.
 *
 * Якщо після генерації score < QUALITY_THRESHOLD або null — повертає `applied: false`
 * і rollback() видаляє згенеровані файли, щоб наступний рунг бачив їх як `missing`.
 *
 * Контракт worker-seam (orchestrator.mjs): повертає `{ applied, touchedFiles, error, rollback }`.
 */

import { join } from 'node:path'
import { existsSync, rmSync } from 'node:fs'
import { runGenerationBatch } from './docgen-files-batch.mjs'
import { scanForDocFiles } from './docgen-scan.mjs'
import { QUALITY_THRESHOLD, readDocQuality } from './docgen-crc.mjs'

/**
 * Парсить stale-файли з violation-output рядка `❌ <path> (reason)`.
 * Якщо явних шляхів немає — бере всі поточні stale з scanForDocFiles.
 * @param {string} violation вивід з `main()` lint.mjs
 * @param {string} cwd корінь проєкту
 * @returns {Array<{sourcePath:string,docPath:string,stale:boolean,reason:string}>}
 */
function parseStaleFromViolation(violation, cwd) {
  const all = scanForDocFiles(cwd)
  const mentioned = new Set()
  for (const line of violation.split('\n')) {
    const m = line.match(/❌\s+(.+?)\s+\((crc-mismatch|missing|degraded)\)/)
    if (m) mentioned.add(m[1].trim())
  }
  if (mentioned.size === 0) return all.filter(f => f.stale)
  // degraded-файли не є stale по CRC, тому беремо по sourcePath без фільтра stale
  return all.filter(f => mentioned.has(f.sourcePath))
}

/**
 * Fix-worker для `doc-files`: генерує доки тільки для файлів зі violation-списку.
 * Після генерації перевіряє score — якщо будь-який файл degraded (score < порогу або null),
 * повертає applied:false і rollback видаляє їх, щоб наступний рунг переробив з кращою моделлю.
 * @param {string} _ruleId 'doc-files'
 * @param {string} violation violation-output з ❌-рядками
 * @param {string} cwd корінь проєкту
 * @returns {Promise<{ applied: boolean, touchedFiles: string[], error: string|null, rollback: () => void }>}
 */
export async function runDocFilesFixWorker(_ruleId, violation, cwd) {
  const targets = parseStaleFromViolation(violation, cwd)
  if (targets.length === 0) {
    return { applied: false, touchedFiles: [], error: 'doc-files: жодного stale-файлу у violation', rollback: () => {} }
  }

  const docPaths = targets.map(f => join(cwd, f.docPath))
  const rollback = () => {
    for (const p of docPaths) {
      if (existsSync(p)) rmSync(p)
    }
  }

  try {
    await runGenerationBatch(targets, cwd, { headline: `  📄 doc-files: генерація ${targets.length} доки(ів)` })

    // Перевіряємо якість кожного згенерованого файлу.
    // Деградовані файли видаляємо ЗАРАЗ, до return — щоб external recheck
    // оркестратора (який іде до rollback) бачив їх як missing і повертав failure.
    const degraded = docPaths.filter(p => {
      if (!existsSync(p)) return true
      const { score } = readDocQuality(p)
      return score === null || score < QUALITY_THRESHOLD
    })

    if (degraded.length > 0) {
      const names = degraded.map(p => p.split('/').pop()).join(', ')
      for (const p of degraded) {
        if (existsSync(p)) rmSync(p)
      }
      return {
        applied: false,
        touchedFiles: docPaths.filter(p => existsSync(p)),
        error: `degraded (score < ${QUALITY_THRESHOLD} або null): ${names}`,
        rollback: () => {} // файли вже видалено вище
      }
    }

    return { applied: true, touchedFiles: docPaths.filter(p => existsSync(p)), error: null, rollback }
  } catch (e) {
    return { applied: false, touchedFiles: [], error: e.message, rollback }
  }
}
