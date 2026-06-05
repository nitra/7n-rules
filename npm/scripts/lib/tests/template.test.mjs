import { describe, expect, test } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { mkdir, rm, writeFile } from 'node:fs/promises'

import {
  checkContains,
  checkDeny,
  checkSnippet,
  checkTextSubset,
  loadTemplate,
  resolveConcernTemplateData
} from '../template.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURES = join(HERE, '__fixtures__', 'template')

const CANON_LINT_SECURITY =
  'trufflehog filesystem . --no-update --exclude-paths .trufflehog-exclude --results=verified,unknown --fail'

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

  test('parses JSON string values that contain `/*` and `*/` (glob patterns) without stripping them', async () => {
    // Regression: stripJsonComments used to greedily strip `/*…*/` regardless of string
    // context, smashing array elements like "**/node_modules/**" together.
    const concernDir = join(FIXTURES, 'json-with-globs', 'policy', 'cspell')
    const tplDir = join(concernDir, 'template')
    await mkdir(tplDir, { recursive: true })
    await writeFile(
      join(tplDir, '.cspell.json.snippet.json'),
      JSON.stringify({
        version: '0.2',
        ignorePaths: [
          '**/node_modules/**',
          '**/vscode-extension/**',
          '**/.git/**',
          '.vscode',
          'report',
          '*.svg',
          '**/k8s/**/*.yaml'
        ]
      })
    )
    try {
      const tpl = await loadTemplate(concernDir)
      expect(tpl['.cspell.json'].snippet.ignorePaths).toEqual([
        '**/node_modules/**',
        '**/vscode-extension/**',
        '**/.git/**',
        '.vscode',
        'report',
        '*.svg',
        '**/k8s/**/*.yaml'
      ])
    } finally {
      await rm(join(FIXTURES, 'json-with-globs'), { recursive: true, force: true })
    }
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

  test('array of objects: structural-subset match (extra attrs + extra keys allowed)', () => {
    const snippet = { steps: [{ uses: 'actions/checkout@v6', with: { 'fetch-depth': 0 } }] }
    const actual = {
      steps: [
        { name: 'Checkout', with: { 'persist-credentials': true, 'fetch-depth': 0 }, uses: 'actions/checkout@v6' }
      ]
    }
    expect(checkSnippet(actual, snippet, opts)).toEqual([])
  })

  test('array of objects: order-insensitive (snippet element found anywhere in actual)', () => {
    const snippet = { steps: [{ uses: 'JS-DevTools/npm-publish@v4.1.5' }] }
    const actual = { steps: [{ uses: 'actions/checkout@v6' }, { uses: 'JS-DevTools/npm-publish@v4.1.5' }] }
    expect(checkSnippet(actual, snippet, opts)).toEqual([])
  })

  test('array of objects: missing element reported by identifying key', () => {
    const snippet = { steps: [{ uses: 'JS-DevTools/npm-publish@v4.1.5', with: { package: 'npm/package.json' } }] }
    const actual = { steps: [{ uses: 'actions/checkout@v6' }] }
    expect(checkSnippet(actual, snippet, opts)).toEqual([
      'package.json: steps має містити елемент з uses: "JS-DevTools/npm-publish@v4.1.5" (security.mdc)'
    ])
  })

  test('array of objects: element present but missing a required nested field → reported', () => {
    const snippet = { steps: [{ uses: 'actions/checkout@v6', with: { 'fetch-depth': 0 } }] }
    const actual = { steps: [{ uses: 'actions/checkout@v6', with: { 'persist-credentials': true } }] }
    expect(checkSnippet(actual, snippet, opts)).toEqual([
      'package.json: steps має містити елемент з uses: "actions/checkout@v6" (security.mdc)'
    ])
  })

  test('returns empty for null snippet (no template provided)', () => {
    expect(checkSnippet({}, null, opts)).toEqual([])
    expect(checkSnippet({}, undefined, opts)).toEqual([])
  })

  test('snippet is array but actual is not → violation + early return (lines 131-132)', () => {
    const result = checkSnippet('not-an-array', ['a', 'b'], opts)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('має бути масивом')
  })

  test('snippet is object but actual is not → violation + early return (lines 144-145)', () => {
    const result = checkSnippet('not-an-object', { key: 'val' }, opts)
    expect(result).toHaveLength(1)
    expect(result[0]).toContain("має бути об'єктом")
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
    expect(checkDeny(actual, deny, opts)).toEqual(['package.json: a.b.c — кореневий c заборонений (security.mdc)'])
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
    expect(checkContains(actual, contains, opts).toSorted()).toEqual(
      [
        'package.json: scripts.lint має містити "bun run lint-security" (security.mdc)',
        'package.json: scripts.lint має містити "oxfmt ." (security.mdc)'
      ].toSorted()
    )
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

  test('contains is a primitive number → return [] (line 217)', () => {
    expect(checkContains('anything', 42, opts)).toEqual([])
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
    const data = await resolveConcernTemplateData(join(FIXTURES, 'security-pkgjson', 'policy', 'package_json'), {
      files: { single: 'package.json' }
    })
    expect(data?.snippet?.scripts?.['lint-security']).toBe(CANON_LINT_SECURITY)
  })

  test('walkGlob string — picks by glob basename', async () => {
    const data = await resolveConcernTemplateData(join(FIXTURES, 'security-pkgjson', 'policy', 'package_json'), {
      files: { walkGlob: '**/package.json' }
    })
    expect(data?.snippet?.scripts?.['lint-security']).toBe(CANON_LINT_SECURITY)
  })

  test('walkGlob array — skips negative patterns and picks first matching template', async () => {
    const data = await resolveConcernTemplateData(join(FIXTURES, 'security-pkgjson', 'policy', 'package_json'), {
      files: { walkGlob: ['!**/dist/**', '**/package.json'] }
    })
    expect(data?.snippet?.scripts?.['lint-security']).toBe(CANON_LINT_SECURITY)
  })

  test('returns undefined when no template matches target basename', async () => {
    const data = await resolveConcernTemplateData(join(FIXTURES, 'security-pkgjson', 'policy', 'package_json'), {
      files: { single: 'unrelated.yml' }
    })
    expect(data).toBeUndefined()
  })
})
