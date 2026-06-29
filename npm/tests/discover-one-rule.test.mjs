import { afterEach, describe, expect, test } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverOneRule } from '../scripts/lib/discover-checkable-rules.mjs'

/** @type {string[]} */
const tmpRoots = []

/**
 * Створює тимчасове fake-правило з concern-dirs для discoverOneRule.
 * @param {{id: string, concerns?: Array<{name: string, check?: boolean, policy?: object, lint?: object}>}} opts
 * @returns {string} абсолютний шлях до `rules/<id>/`
 */
function makeFakeRule({ id, concerns = [] }) {
  const root = mkdtempSync(join(tmpdir(), 'discover-one-rule-'))
  tmpRoots.push(root)
  const ruleDir = join(root, id)
  mkdirSync(ruleDir, { recursive: true })

  for (const c of concerns) {
    const concernDir = join(ruleDir, c.name)
    mkdirSync(concernDir, { recursive: true })
    const meta = { $schema: 'https://unpkg.com/@nitra/cursor/schemas/concern.json' }
    if (c.check) meta.check = true
    if (c.policy) meta.policy = c.policy
    if (c.lint) meta.lint = c.lint
    writeFileSync(join(concernDir, 'concern.json'), JSON.stringify(meta))
  }
  return ruleDir
}

afterEach(() => {
  while (tmpRoots.length > 0) rmSync(tmpRoots.pop(), { recursive: true, force: true })
})

describe('discoverOneRule', () => {
  test('повертає concerns для правила з обома (check + policy)', async () => {
    const ruleDir = makeFakeRule({
      id: 'abie',
      concerns: [
        { name: 'applies', check: true },
        { name: 'env_dns', check: true },
        { name: 'http_route_base', policy: { file: 'target.json' } }
      ]
    })
    const rule = await discoverOneRule(ruleDir, 'abie')
    expect(rule.id).toBe('abie')
    expect(rule.concerns.map(c => c.name)).toEqual(['applies', 'env_dns', 'http_route_base'])
    expect(rule.concerns.filter(c => c.check === true).map(c => c.name)).toEqual(['applies', 'env_dns'])
    expect(rule.concerns.filter(c => c.policy != null).map(c => c.name)).toEqual(['http_route_base'])
  })

  test('правило без policy-concerns — concerns не містить policy', async () => {
    const ruleDir = makeFakeRule({
      id: 'js',
      concerns: [{ name: 'tooling', check: true }]
    })
    const rule = await discoverOneRule(ruleDir, 'js')
    expect(rule.concerns.filter(c => c.policy != null)).toEqual([])
    expect(rule.concerns.map(c => c.name)).toEqual(['tooling'])
  })

  test('правило лише з policy-concerns — concerns без check', async () => {
    const ruleDir = makeFakeRule({
      id: 'rego',
      concerns: [{ name: 'only_rego', policy: { file: 'data.rego' } }]
    })
    const rule = await discoverOneRule(ruleDir, 'rego')
    expect(rule.concerns.filter(c => c.check === true)).toEqual([])
    expect(rule.concerns.map(c => c.name)).toEqual(['only_rego'])
  })
})
