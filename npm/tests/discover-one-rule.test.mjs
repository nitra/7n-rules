import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverOneRule } from '../scripts/utils/discover-checkable-rules.mjs'

/** @type {string[]} */
const tmpRoots = []

function makeFakeRule({ id, jsConcerns = [], policyConcerns = [] }) {
  const root = mkdtempSync(join(tmpdir(), 'discover-one-rule-'))
  tmpRoots.push(root)
  const ruleDir = join(root, id)
  mkdirSync(ruleDir, { recursive: true })

  for (const concern of jsConcerns) {
    mkdirSync(join(ruleDir, 'js', concern), { recursive: true })
    writeFileSync(join(ruleDir, 'js', concern, 'check.mjs'), '')
  }
  for (const concern of policyConcerns) {
    mkdirSync(join(ruleDir, 'policy', concern), { recursive: true })
    writeFileSync(join(ruleDir, 'policy', concern, 'target.json'), '{}')
  }
  return ruleDir
}

afterEach(() => {
  while (tmpRoots.length > 0) rmSync(tmpRoots.pop(), { recursive: true, force: true })
})

describe('discoverOneRule', () => {
  test('повертає JS + policy concerns для правила з обома', async () => {
    const ruleDir = makeFakeRule({
      id: 'abie',
      jsConcerns: ['env_dns', 'applies'],
      policyConcerns: ['http_route_base']
    })
    const rule = await discoverOneRule(ruleDir, 'abie')
    expect(rule.id).toBe('abie')
    expect(rule.jsConcerns.map(c => c.name)).toEqual(['applies', 'env_dns'])
    expect(rule.policyConcerns.map(c => c.name)).toEqual(['http_route_base'])
  })

  test('правило без policy — повертає пустий policyConcerns', async () => {
    const ruleDir = makeFakeRule({ id: 'js-lint', jsConcerns: ['tooling'] })
    const rule = await discoverOneRule(ruleDir, 'js-lint')
    expect(rule.policyConcerns).toEqual([])
  })

  test('правило без fix/ — повертає пустий jsConcerns', async () => {
    const ruleDir = makeFakeRule({ id: 'rego', policyConcerns: ['only_rego'] })
    const rule = await discoverOneRule(ruleDir, 'rego')
    expect(rule.jsConcerns).toEqual([])
    expect(rule.policyConcerns.map(c => c.name)).toEqual(['only_rego'])
  })
})
