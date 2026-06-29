/**
 * Standalone CLI runner для одного правила (debug / override).
 * Inline concern execution — без subprocess.
 */
import { basename } from 'node:path'

import { discoverOneRule } from './discover-checkable-rules.mjs'
import { runRule } from './run-rule.mjs'
import { getOrCreateWalkCache } from '../utils/walk-cache.mjs'
import { withLock } from '../utils/with-lock.mjs'

export { isRunAsCli } from '../cli-entry.mjs'

const PACKAGE_NAME = '@nitra/cursor'

/**
 * @param {string} ruleDir абсолютний шлях до `rules/<id>/`
 * @returns {Promise<number>} 0 — OK; 1 — порушення
 */
export async function runRuleCli(ruleDir) {
  const ruleId = basename(ruleDir)
  const bundledRulesDir = ruleDir.slice(0, ruleDir.lastIndexOf('/'))

  console.log(`\n🔍 ${PACKAGE_NAME} fix ${ruleId} — перевірка правила\n`)

  const exitCode = await withLock(`fix-${ruleId}`, async () => {
    const rule = await discoverOneRule(ruleDir, ruleId)
    const walkCache = getOrCreateWalkCache()
    return runRule(rule, bundledRulesDir, walkCache)
  })
  const ok = exitCode === 0
  console.log(`\n✨ Результат: ${ok ? 1 : 0}/1 правил без зауважень\n`)
  return exitCode
}
