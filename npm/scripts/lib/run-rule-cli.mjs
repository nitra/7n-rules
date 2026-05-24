/**
 * Standalone CLI runner для одного правила. Викликається з `rules/<id>/fix.mjs`
 * у блоці `if (import.meta.main)` — це робить `bun rules/<id>/fix.mjs` повним
 * еквівалентом старого `npx @nitra/cursor fix <id>`: читає `.n-cursor.json`,
 * перевіряє whitelist, друкує summary, повертає aggregated exit-code.
 *
 * Library-mode виклик з CLI orchestration — інше: див. `runStandardRule` + `fix.mjs::run(ctx)`.
 */
import { basename } from 'node:path'

import { isRuleEnabled, readNCursorConfigLite } from './read-n-cursor-config-lite.mjs'
import { runStandardRule } from './run-standard-rule.mjs'
import { getOrCreateWalkCache } from '../utils/walk-cache.mjs'

const PACKAGE_NAME = '@nitra/cursor'

/**
 * @param {string} ruleDir абсолютний шлях до `rules/<id>/`
 * @returns {Promise<number>} 0 — OK або правило не enabled; 1 — порушення
 */
export async function runRuleCli(ruleDir) {
  const ruleId = basename(ruleDir)
  const config = await readNCursorConfigLite()

  if (!isRuleEnabled(config, ruleId)) {
    console.log(`\n🔍 ${PACKAGE_NAME} fix ${ruleId} — правило не в \`.n-cursor.json:rules\`. Пропущено.\n`)
    return 0
  }

  console.log(`\n🔍 ${PACKAGE_NAME} fix ${ruleId} — перевірка правила\n`)

  const walkCache = getOrCreateWalkCache()
  const exitCode = await runStandardRule(ruleDir, { walkCache })
  const ok = exitCode === 0
  console.log(`\n✨ Результат: ${ok ? 1 : 0}/1 правил без зауважень\n`)
  return exitCode
}
