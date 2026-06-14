/**
 * Конформність-детект (колишній subcommand `_fix-check`) як ПРЯМА функція — без subprocess-обгортки
 * `bun n-cursor.js _fix-check`. Викликають конформність-фаза `lint` (read-only), движок
 * (`orchestrator.mjs`, `t0.mjs`) і PostToolUse-хук.
 *
 * Per-rule ізоляція зберігається: кожне `rules/<id>/fix.mjs` усе ще запускається окремим
 * процесом `bun` (config-loading + whitelist + crash-isolation). Прибрано лише зовнішній
 * wrapper-subprocess, що його раніше шелили оркестратор/хук.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cwd as processCwd } from 'node:process'

import { listRuleIds } from '../list-rule-ids.mjs'
import { ensureTool } from '../ensure-tool.mjs'
import { discoverCheckRulesFromCursorRules } from '../discover-check-rules-from-cursor.mjs'
import { listProjectRulesMdcFiles } from '../list-project-rules-mdc.mjs'

// Цей файл: npm/scripts/lib/fix/run-fix-check.mjs → npm/rules (чотири dirname угору + rules).
const BUNDLED_RULES_DIR = join(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))), 'rules')

/**
 * Визначає id правил для прогону: явні (з валідацією) або discovery з `.cursor/rules/*.mdc`.
 * @param {string[]} requestedRules запитані (порожній → discovery)
 * @param {string[]} available доступні rule-id у пакеті
 * @param {string} cwd корінь
 * @returns {Promise<string[]>} id для прогону (можливо порожній)
 * @throws {Error} на невідомих явно заданих правилах
 */
async function resolveCheckRuleIds(requestedRules, available, cwd) {
  if (requestedRules.length > 0) {
    const unknown = requestedRules.filter(id => !available.includes(id))
    if (unknown.length > 0) throw new Error(`Unknown rules: ${unknown.join(', ')}`)
    return requestedRules
  }
  const mdcFiles = await listProjectRulesMdcFiles(cwd)
  if (mdcFiles.length === 0) return []
  return discoverCheckRulesFromCursorRules(available, mdcFiles)
}

/**
 * Прогоняє `fix.mjs` кожного правила окремим процесом, захоплюючи output.
 * @param {string[]} idsToRun правила
 * @param {string} cwd корінь
 * @returns {{ totalFailed:number, rules:Array<{ruleId:string, ok:boolean, output:string}> }} результат
 */
function runRuleFixProcesses(idsToRun, cwd) {
  let totalFailed = 0
  const rules = []
  for (const id of idsToRun) {
    const r = spawnSync('bun', [join(BUNDLED_RULES_DIR, id, 'fix.mjs')], { cwd, encoding: 'utf8' })
    const ok = r.status === 0
    rules.push({ ruleId: id, ok, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() })
    if (!ok) totalFailed++
  }
  return { totalFailed, rules }
}

/**
 * Конформність-детект: per-rule `fix.mjs run()` (= перевірка, без мутацій).
 * @param {string[]} [requestedRules] фільтр (порожній → discovery з `.cursor/rules/`)
 * @param {string} [cwd] корінь
 * @returns {Promise<{ total:number, failed:number, rules:Array<{ruleId:string, ok:boolean, output:string}> }>} результат
 */
export async function runFixCheck(requestedRules = [], cwd = processCwd()) {
  ensureTool('conftest')
  const available = await listRuleIds(BUNDLED_RULES_DIR)
  if (available.length === 0) return { total: 0, failed: 0, rules: [] }

  const idsToRun = await resolveCheckRuleIds(requestedRules, available, cwd)
  if (idsToRun.length === 0) return { total: 0, failed: 0, rules: [] }

  const { totalFailed, rules } = runRuleFixProcesses(idsToRun, cwd)
  return { total: idsToRun.length, failed: totalFailed, rules }
}
