import { afterEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runStandardRule } from '../scripts/lib/run-standard-rule.mjs'
import { resetWalkCache } from '../scripts/utils/walk-cache.mjs'

/** @type {string[]} */
const tmpRoots = []

afterEach(() => {
  resetWalkCache()
  while (tmpRoots.length > 0) rmSync(tmpRoots.pop(), { recursive: true, force: true })
})

/**
 * Мінімальне правило з одним check concern для unit-тестів runStandardRule.
 * @param {string} id ідентифікатор правила в тимчасовому дереві
 * @param {string} [mainBody] вміст main.mjs (default: повертає 0)
 * @returns {string} абсолютний шлях до `rules/<id>/`
 */
function makeMinimalRule(id, mainBody = 'export async function main() { return 0 }') {
  const root = mkdtempSync(join(tmpdir(), 'run-standard-rule-'))
  tmpRoots.push(root)
  const ruleDir = join(root, id)
  const concernDir = join(ruleDir, 'check')
  mkdirSync(concernDir, { recursive: true })
  writeFileSync(
    join(concernDir, 'concern.json'),
    JSON.stringify({ $schema: 'https://unpkg.com/@nitra/cursor/schemas/concern.json', check: true })
  )
  writeFileSync(join(concernDir, 'main.mjs'), mainBody)
  return ruleDir
}

describe('runStandardRule', () => {
  test('повертає 0 коли check concern проходить', async () => {
    const ruleDir = makeMinimalRule('test-rule')
    const code = await runStandardRule(ruleDir)
    expect(code).toBe(0)
  })

  test('повертає 1 коли check concern повертає 1', async () => {
    const ruleDir = makeMinimalRule('fail-rule', 'export async function main() { return 1 }')
    const code = await runStandardRule(ruleDir)
    expect(code).toBe(1)
  })

  test('використовує переданий walkCache замість singleton', async () => {
    const ruleDir = makeMinimalRule('test-rule')
    const customCache = new Map([['marker', Promise.resolve(['fake'])]])
    await runStandardRule(ruleDir, { walkCache: customCache })
    expect(customCache.has('marker')).toBe(true)
  })
})
