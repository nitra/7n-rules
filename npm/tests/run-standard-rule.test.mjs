import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runStandardRule } from '../scripts/utils/run-standard-rule.mjs'
import { resetWalkCache } from '../scripts/utils/walk-cache.mjs'

/** @type {string[]} */
const tmpRoots = []

afterEach(() => {
  resetWalkCache()
  while (tmpRoots.length > 0) rmSync(tmpRoots.pop(), { recursive: true, force: true })
})

function makeMinimalRule(id) {
  const root = mkdtempSync(join(tmpdir(), 'run-standard-rule-'))
  tmpRoots.push(root)
  const ruleDir = join(root, id)
  mkdirSync(ruleDir, { recursive: true })
  mkdirSync(join(ruleDir, 'js', 'applies'), { recursive: true })
  writeFileSync(
    join(ruleDir, 'js', 'applies', 'check.mjs'),
    'export function applies() { return false }\nexport function check() { return 0 }\n'
  )
  return ruleDir
}

describe('runStandardRule', () => {
  test('повертає 0 коли applies() === false (правило пропущено)', async () => {
    const ruleDir = makeMinimalRule('test-rule')
    const code = await runStandardRule(ruleDir)
    expect(code).toBe(0)
  })

  test('використовує переданий walkCache замість singleton', async () => {
    const ruleDir = makeMinimalRule('test-rule')
    const customCache = new Map()
    customCache.set('marker', Promise.resolve(['fake']))
    await runStandardRule(ruleDir, { walkCache: customCache })
    expect(customCache.has('marker')).toBe(true)
  })
})
