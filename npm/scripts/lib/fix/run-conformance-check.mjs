/**
 * Конформність-детект як ПРЯМА функція — без subprocess-обгортки.
 * Викликають конформність-фаза `lint` (read-only), движок (`orchestrator.mjs`, `t0.mjs`)
 * і PostToolUse-хук.
 *
 * Inline execution (без subprocess): concerns виконуються в поточному процесі;
 * withLock збережено для race-protection паралельних прогонів того самого правила.
 *
 * Селекція активних правил — виключно тут (`resolveCheckRuleIds` за `.n-cursor.json`).
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cwd as processCwd } from 'node:process'

import { listRuleIds } from '../list-rule-ids.mjs'
import { ensureTool } from '../ensure-tool.mjs'
import { discoverCheckRulesFromCursorRules } from '../discover-check-rules-from-cursor.mjs'
import { listProjectRulesMdcFiles } from '../list-project-rules-mdc.mjs'
import { isRuleEnabled, readNCursorConfigLite } from '../read-n-cursor-config-lite.mjs'

// Цей файл: npm/scripts/lib/fix/run-conformance-check.mjs → npm/rules (чотири dirname угору + rules).
const BUNDLED_RULES_DIR = join(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))), 'rules')

/**
 * Визначає id правил для прогону. `.n-cursor.json` — **єдине джерело правди** селекції:
 *  - явні `requestedRules` — валідуються проти `available`, тоді звужуються до активних
 *    (явний запит лише фільтрує всередині активних, не вмикає вимкнене правило);
 *  - без явних і конфіг **є** — беремо саме активні правила конфіга (`available ∩ enabled`).
 *    Це прибирає дрейф «правило в `.n-cursor.json:rules`, але `.cursor/rules/*.mdc` нема
 *    (sync не прогнаний) → раніше тихо пропускалось»;
 *  - без явних і конфіга **нема** — open-by-default debug: fallback на зматеріалізовані
 *    `.cursor/rules/*.mdc` (єдиний сигнал «що встановлено», коли немає whitelist).
 *
 * Per-rule дубль-гейту (`runRuleCli → isRuleEnabled`) більше немає — гейтинг живе лише тут.
 * @param {string[]} requestedRules запитані (порожній → auto-селекція)
 * @param {string[]} available доступні rule-id у пакеті (алфавітно)
 * @param {string} cwd корінь
 * @returns {Promise<string[]>} id для прогону (можливо порожній)
 * @throws {Error} на невідомих явно заданих правилах
 */
export async function resolveCheckRuleIds(requestedRules, available, cwd) {
  const config = await readNCursorConfigLite(cwd)

  if (requestedRules.length > 0) {
    const unknown = requestedRules.filter(id => !available.includes(id))
    if (unknown.length > 0) throw new Error(`Unknown rules: ${unknown.join(', ')}`)
    return requestedRules
  }

  if (config.exists) {
    return available.filter(id => isRuleEnabled(config, id))
  }

  // Конфіга нема → fallback на зматеріалізоване (debug / open-by-default).
  const mdcFiles = await listProjectRulesMdcFiles(cwd)
  if (mdcFiles.length === 0) return []
  return discoverCheckRulesFromCursorRules(available, mdcFiles)
}

/**
 * Прогоняє check-concerns кожного правила inline (в поточному процесі).
 * @param {string[]} idsToRun правила
 * @param {string} cwd корінь
 * @returns {Promise<{ totalFailed:number, rules:Array<{ruleId:string, ok:boolean, output:string}> }>}
 */
async function runRuleCheckProcesses(idsToRun, cwd) {
  const { discoverOneRule } = await import('../discover-checkable-rules.mjs')
  const { runRule } = await import('../run-rule.mjs')
  const { getOrCreateWalkCache } = await import('../../utils/walk-cache.mjs')
  const { withLock } = await import('../../utils/with-lock.mjs')
  let totalFailed = 0
  const rules = []
  for (const id of idsToRun) {
    const ruleDir = join(BUNDLED_RULES_DIR, id)
    const lines = []
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = chunk => {
      lines.push(String(chunk))
      return true
    }
    let ok = true
    try {
      const exitCode = await withLock(`fix-${id}`, async () => {
        const rule = await discoverOneRule(ruleDir, id)
        const walkCache = getOrCreateWalkCache()
        return runRule(rule, BUNDLED_RULES_DIR, walkCache)
      })
      ok = exitCode === 0
    } catch (err) {
      lines.push(String(err?.message ?? err))
      ok = false
    } finally {
      process.stdout.write = origWrite
    }
    rules.push({ ruleId: id, ok, output: lines.join('').trim() })
    if (!ok) totalFailed++
  }
  return { totalFailed, rules }
}

/**
 * Конформність-детект: per-rule `check.mjs run()` (= перевірка, без мутацій).
 * @param {string[]} [requestedRules] фільтр (порожній → discovery з `.cursor/rules/`)
 * @param {string} [cwd] корінь
 * @returns {Promise<{ total:number, failed:number, rules:Array<{ruleId:string, ok:boolean, output:string}> }>} результат
 */
export async function runConformanceCheck(requestedRules = [], cwd = processCwd()) {
  ensureTool('conftest')
  const available = await listRuleIds(BUNDLED_RULES_DIR)
  if (available.length === 0) return { total: 0, failed: 0, rules: [] }

  const idsToRun = await resolveCheckRuleIds(requestedRules, available, cwd)
  if (idsToRun.length === 0) return { total: 0, failed: 0, rules: [] }

  const { totalFailed, rules } = await runRuleCheckProcesses(idsToRun, cwd)
  return { total: idsToRun.length, failed: totalFailed, rules }
}
