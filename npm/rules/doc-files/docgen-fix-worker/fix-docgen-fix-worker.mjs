/**
 * Спеціалізований fix-worker для правила `doc-files` — замінює автономний pi-agent
 * контрольованим пайплайном: парсить stale-файли з violation-output і передає їх
 * безпосередньо в `runGenerationBatch`. Жодних зайвих `edit`/`write` поза переліком.
 *
 * Якщо після генерації score < QUALITY_THRESHOLD або null — повертає `applied: false`
 * і видаляє файли, щоб наступний рунг бачив їх як `missing`. Виняток: last rung
 * (isAvg=true) — зберігає best-effort з tier:cloud-avg; наступний `gen` пропускає
 * такі файли бо `selectTargets` перевіряє `tier !== cloud-avg`.
 *
 * Контракт worker-seam (orchestrator.mjs): повертає `{ applied, touchedFiles, error, rollback }`.
 */

import { join } from 'node:path'
import { existsSync, rmSync } from 'node:fs'
import { runGenerationBatch } from '../docgen-files-batch/main.mjs'
import { scanForDocFiles } from '../docgen-scan/main.mjs'
import { QUALITY_THRESHOLD, readDocQuality } from '../docgen-crc/main.mjs'

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
 * @param {string} _ruleId 'doc-files'
 * @param {string} violation violation-output з ❌-рядками
 * @param {string} cwd корінь проєкту
 * @param {{ isAvg?: boolean, model?: string, tier?: string }} [opts]
 * @returns {Promise<{ applied: boolean, touchedFiles: string[], error: string|null, rollback: () => void }>}
 */
export async function runDocFilesFixWorker(_ruleId, violation, cwd, opts = {}) {
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
    await runGenerationBatch(targets, cwd, {
      headline: `  📄 doc-files: генерація ${targets.length} доки(ів)`,
      model: opts.model,
      tier: opts.tier
    })

    // Перевіряємо якість кожного згенерованого файлу.
    // Деградовані файли видаляємо ЗАРАЗ, до return — щоб external recheck
    // оркестратора (який іде до rollback) бачив їх як missing і повертав failure.
    // Виняток: isAvg (cloud-avg) — зберігаємо best-effort; tier:cloud-avg вже
    // записаний у frontmatter через generateOne, тому selectTargets пропускатиме
    // ці файли на наступних прогонах без окремого retried-прапора.
    const degraded = docPaths.filter(p => {
      if (!existsSync(p)) return true
      const { score } = readDocQuality(p)
      return score === null || score < QUALITY_THRESHOLD
    })

    if (degraded.length > 0) {
      const names = degraded.map(p => p.split('/').pop()).join(', ')
      if (opts.isAvg) {
        return { applied: true, touchedFiles: docPaths.filter(p => existsSync(p)), error: null, rollback }
      }
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
