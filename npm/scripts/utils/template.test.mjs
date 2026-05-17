import { describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkDeny, checkSnippet, loadTemplate } from './template.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '__fixtures__', 'template')

describe('loadTemplate', () => {
  test('reads snippet/deny/contains from policy/<concern>/template/ for package.json target', async () => {
    const concernDir = join(FIXTURES, 'security-pkgjson', 'policy', 'package_json')
    const tpl = await loadTemplate(concernDir)
    expect(tpl).toEqual({
      'package.json': {
        snippet: { scripts: { 'lint-security': 'gitleaks detect --no-banner' } },
        deny: {
          dependencies: { gitleaks: 'глобальний CLI — не додавай у dependencies' },
          devDependencies: { gitleaks: 'глобальний CLI — не додавай у devDependencies' }
        },
        contains: { scripts: { lint: ['bun run lint-security'] } }
      }
    })
  })

  test('returns empty object when template/ missing', async () => {
    const concernDir = join(FIXTURES, 'empty-concern', 'policy', 'empty')
    const tpl = await loadTemplate(concernDir)
    expect(tpl).toEqual({})
  })
})

describe('checkSnippet', () => {
  const opts = { targetPath: 'package.json', source: 'security.mdc' }

  test('returns empty for exact match on leaves', () => {
    const actual = { scripts: { 'lint-security': 'gitleaks detect --no-banner' } }
    const snippet = { scripts: { 'lint-security': 'gitleaks detect --no-banner' } }
    expect(checkSnippet(actual, snippet, opts)).toEqual([])
  })

  test('reports missing leaf with path and expected value', () => {
    const actual = { scripts: {} }
    const snippet = { scripts: { 'lint-security': 'gitleaks detect --no-banner' } }
    expect(checkSnippet(actual, snippet, opts)).toEqual([
      'package.json: scripts."lint-security" має бути "gitleaks detect --no-banner" (security.mdc)'
    ])
  })

  test('reports mismatched leaf value', () => {
    const actual = { scripts: { 'lint-security': 'gitleaks detect' } }
    const snippet = { scripts: { 'lint-security': 'gitleaks detect --no-banner' } }
    expect(checkSnippet(actual, snippet, opts)).toEqual([
      'package.json: scripts."lint-security" має бути "gitleaks detect --no-banner" (security.mdc)'
    ])
  })

  test('arrays are subset-of: pass when all snippet elements present in actual', () => {
    const actual = { recommendations: ['a', 'b', 'c'] }
    const snippet = { recommendations: ['a', 'b'] }
    expect(checkSnippet(actual, snippet, opts)).toEqual([])
  })

  test('arrays are subset-of: fail when snippet element missing', () => {
    const actual = { recommendations: ['a'] }
    const snippet = { recommendations: ['a', 'b'] }
    expect(checkSnippet(actual, snippet, opts)).toEqual([
      'package.json: recommendations має містити "b" (security.mdc)'
    ])
  })

  test('returns empty for null snippet (no template provided)', () => {
    expect(checkSnippet({}, null, opts)).toEqual([])
    expect(checkSnippet({}, undefined, opts)).toEqual([])
  })
})

describe('checkDeny', () => {
  const opts = { targetPath: 'package.json', source: 'security.mdc' }

  test('returns empty when no forbidden path is present', () => {
    const actual = { dependencies: { lodash: '^4' } }
    const deny = { dependencies: { gitleaks: 'CLI — не додавай' } }
    expect(checkDeny(actual, deny, opts)).toEqual([])
  })

  test('reports forbidden path with reason from deny value', () => {
    const actual = { dependencies: { gitleaks: '^8.0.0', lodash: '^4' } }
    const deny = { dependencies: { gitleaks: 'CLI — не додавай у dependencies' } }
    expect(checkDeny(actual, deny, opts)).toEqual([
      'package.json: dependencies.gitleaks — CLI — не додавай у dependencies (security.mdc)'
    ])
  })

  test('handles deeply nested forbidden paths', () => {
    const actual = { a: { b: { c: 1 } } }
    const deny = { a: { b: { c: 'кореневий c заборонений' } } }
    expect(checkDeny(actual, deny, opts)).toEqual([
      'package.json: a.b.c — кореневий c заборонений (security.mdc)'
    ])
  })

  test('returns empty for null deny', () => {
    expect(checkDeny({}, null, opts)).toEqual([])
  })
})
