/**
 * Конформність-детект як ПРЯМА функція — без subprocess-обгортки.
 * Викликають конформність-фаза `lint` (read-only), движок (`orchestrator.mjs`, `t0.mjs`)
 * і PostToolUse-хук.
 *
 * Per-rule ізоляція зберігається: entrypoint `rules/<id>/main.mjs` кожного правила
 * запускається окремим процесом `bun` (crash-isolation). Канон — єдиний `main.mjs`
 * (ADR 2026-06-21); його CLI-блок кличе `runRuleCli(import.meta.dirname)`.
 *
 * Селекція активних правил — виключно тут (`resolveCheckRuleIds` за `.n-cursor.json`);
 * per-rule whitelist у спавнених процесах прибрано як дубль (див. `runRuleCli`).
 */
import { spawnSync } from 'node:child_process'
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
 * Прогоняє check-entrypoint кожного правила окремим процесом, захоплюючи output.
 * @param {string[]} idsToRun правила
 * @param {string} cwd корінь
 * @returns {{ totalFailed:number, rules:Array<{ruleId:string, ok:boolean, output:string}> }} результат
 */
function runRuleCheckProcesses(idsToRun, cwd) {
  let totalFailed = 0
  const rules = []
  for (const id of idsToRun) {
    const r = spawnSync('bun', [join(BUNDLED_RULES_DIR, id, 'main.mjs')], { cwd, encoding: 'utf8' })
    const ok = r.status === 0
    rules.push({ ruleId: id, ok, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() })
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

  const { totalFailed, rules } = runRuleCheckProcesses(idsToRun, cwd)
  return { total: idsToRun.length, failed: totalFailed, rules }
}
