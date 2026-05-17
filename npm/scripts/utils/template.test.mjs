import { describe, expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkContains, checkDeny, checkSnippet, checkTextSubset, loadTemplate, resolveConcernTemplateData } from './template.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '__fixtures__', 'template')

const CANON_LINT_SECURITY = 'trufflehog filesystem . --no-update --exclude-paths .trufflehog-exclude --results=verified,unknown --fail'

describe('loadTemplate', () => {
  test('reads snippet/deny/contains from policy/<concern>/template/ for package.json target', async () => {
    const concernDir = join(FIXTURES, 'security-pkgjson', 'policy', 'package_json')
    const tpl = await loadTemplate(concernDir)
    expect(tpl).toEqual({
      'package.json': {
        snippet: { scripts: { 'lint-security': CANON_LINT_SECURITY } },
        deny: {
          dependencies: { trufflehog: 'глобальний CLI — не додавай у dependencies' },
          devDependencies: { trufflehog: 'глобальний CLI — не додавай у devDependencies' }
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
    const actual = { scripts: { 'lint-security': CANON_LINT_SECURITY } }
    const snippet = { scripts: { 'lint-security': CANON_LINT_SECURITY } }
    expect(checkSnippet(actual, snippet, opts)).toEqual([])
  })

  test('reports missing leaf with path and expected value', () => {
    const actual = { scripts: {} }
    const snippet = { scripts: { 'lint-security': CANON_LINT_SECURITY } }
    expect(checkSnippet(actual, snippet, opts)).toEqual([
      `package.json: scripts."lint-security" має бути "${CANON_LINT_SECURITY}" (security.mdc)`
    ])
  })

  test('reports mismatched leaf value', () => {
    const actual = { scripts: { 'lint-security': 'trufflehog filesystem .' } }
    const snippet = { scripts: { 'lint-security': CANON_LINT_SECURITY } }
    expect(checkSnippet(actual, snippet, opts)).toEqual([
      `package.json: scripts."lint-security" має бути "${CANON_LINT_SECURITY}" (security.mdc)`
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
    const deny = { dependencies: { trufflehog: 'CLI — не додавай' } }
    expect(checkDeny(actual, deny, opts)).toEqual([])
  })

  test('reports forbidden path with reason from deny value', () => {
    const actual = { dependencies: { trufflehog: '^3.0.0', lodash: '^4' } }
    const deny = { dependencies: { trufflehog: 'CLI — не додавай у dependencies' } }
    expect(checkDeny(actual, deny, opts)).toEqual([
      'package.json: dependencies.trufflehog — CLI — не додавай у dependencies (security.mdc)'
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

describe('checkContains', () => {
  const opts = { targetPath: 'package.json', source: 'security.mdc' }

  test('returns empty when leaf string contains every required substring', () => {
    const actual = { scripts: { lint: 'bun run lint-text && bun run lint-security && oxfmt .' } }
    const contains = { scripts: { lint: ['bun run lint-security'] } }
    expect(checkContains(actual, contains, opts)).toEqual([])
  })

  test('reports missing substring', () => {
    const actual = { scripts: { lint: 'bun run lint-text && oxfmt .' } }
    const contains = { scripts: { lint: ['bun run lint-security'] } }
    expect(checkContains(actual, contains, opts)).toEqual([
      'package.json: scripts.lint має містити "bun run lint-security" (security.mdc)'
    ])
  })

  test('multiple substrings — reports each missing one', () => {
    const actual = { scripts: { lint: 'bun run lint-text' } }
    const contains = { scripts: { lint: ['bun run lint-security', 'oxfmt .'] } }
    expect(checkContains(actual, contains, opts).sort()).toEqual([
      'package.json: scripts.lint має містити "bun run lint-security" (security.mdc)',
      'package.json: scripts.lint має містити "oxfmt ." (security.mdc)'
    ].sort())
  })

  test('returns empty when actual leaf missing entirely (cannot check substring of nothing)', () => {
    const actual = { scripts: {} }
    const contains = { scripts: { lint: ['bun run lint-security'] } }
    expect(checkContains(actual, contains, opts)).toEqual([
      'package.json: scripts.lint має містити "bun run lint-security" (security.mdc)'
    ])
  })

  test('returns empty for null contains', () => {
    expect(checkContains({}, null, opts)).toEqual([])
  })
})

describe('checkTextSubset', () => {
  const opts = { targetPath: '.stylelintignore', source: 'style-lint.mdc' }

  test('returns empty when actual contains every template line', () => {
    const actual = 'dist/\nnode_modules/\n'
    const template = 'dist/\n'
    expect(checkTextSubset(actual, template, opts)).toEqual([])
  })

  test('reports missing line', () => {
    const actual = 'node_modules/\n'
    const template = 'dist/\n'
    expect(checkTextSubset(actual, template, opts)).toEqual([
      '.stylelintignore: відсутній рядок "dist/" (style-lint.mdc)'
    ])
  })

  test('ignores empty lines and comments (# prefix)', () => {
    const actual = 'dist/\n'
    const template = '# comment\n\ndist/\n'
    expect(checkTextSubset(actual, template, opts)).toEqual([])
  })

  test('returns empty for null template', () => {
    expect(checkTextSubset('anything', null, opts)).toEqual([])
  })
})

describe('resolveConcernTemplateData', () => {
  test('single target — picks template by basename', async () => {
    const data = await resolveConcernTemplateData(
      join(FIXTURES, 'security-pkgjson', 'policy', 'package_json'),
      { files: { single: 'package.json' } }
    )
    expect(data?.snippet?.scripts?.['lint-security']).toBe(CANON_LINT_SECURITY)
  })

  test('walkGlob string — picks by glob basename', async () => {
    const data = await resolveConcernTemplateData(
      join(FIXTURES, 'security-pkgjson', 'policy', 'package_json'),
      { files: { walkGlob: '**/package.json' } }
    )
    expect(data?.snippet?.scripts?.['lint-security']).toBe(CANON_LINT_SECURITY)
  })

  test('walkGlob array — skips negative patterns and picks first matching template', async () => {
    const data = await resolveConcernTemplateData(
      join(FIXTURES, 'security-pkgjson', 'policy', 'package_json'),
      { files: { walkGlob: ['!**/dist/**', '**/package.json'] } }
    )
    expect(data?.snippet?.scripts?.['lint-security']).toBe(CANON_LINT_SECURITY)
  })

  test('returns undefined when no template matches target basename', async () => {
    const data = await resolveConcernTemplateData(
      join(FIXTURES, 'security-pkgjson', 'policy', 'package_json'),
      { files: { single: 'unrelated.yml' } }
    )
    expect(data).toBeUndefined()
  })
})
