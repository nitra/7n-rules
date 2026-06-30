/**
 * Тести T0-codemod `fix-workflows.mjs`: чисті трансформери (addPersistCredentials,
 * removePathsGlobs) на представницьких формах + інтеграція patterns.apply на temp-репо.
 */
import { describe, expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addPersistCredentials, removePathsGlobs, patterns } from '../fix-workflows.mjs'

describe('addPersistCredentials', () => {
  test('bare `- uses: checkout` без with → створює with-блок', () => {
    const src = ['jobs:', '  main:', '    steps:', '      - uses: actions/checkout@v6', ''].join('\n')
    const out = addPersistCredentials(src)
    expect(out).toBe(
      [
        'jobs:',
        '  main:',
        '    steps:',
        '      - uses: actions/checkout@v6',
        '        with:',
        '          persist-credentials: false',
        ''
      ].join('\n')
    )
  })

  test('наявний with-блок → дописує ключ, не дублює with', () => {
    const src = [
      '      - name: Checkout',
      '        uses: actions/checkout@v6',
      '        with:',
      '          fetch-depth: 0 # коментар',
      ''
    ].join('\n')
    const out = addPersistCredentials(src)
    expect(out).toContain('        with:\n          persist-credentials: false\n          fetch-depth: 0 # коментар')
    // не додав другий with:
    expect(out.match(/with:/gu)).toHaveLength(1)
  })

  test('persist-credentials вже є → null (без змін)', () => {
    const src = ['      - uses: actions/checkout@v6', '        with:', '          persist-credentials: false', ''].join(
      '\n'
    )
    expect(addPersistCredentials(src)).toBeNull()
  })

  test('кілька checkout-кроків у файлі → виправляє всі', () => {
    const src = [
      '      - uses: actions/checkout@v6',
      '      - run: echo a',
      '      - uses: actions/checkout@v6',
      ''
    ].join('\n')
    const out = addPersistCredentials(src)
    expect(out.match(/persist-credentials: false/gu)).toHaveLength(2)
  })

  test('не-checkout uses не чіпається', () => {
    const src = ['      - uses: actions/setup-node@v4', ''].join('\n')
    expect(addPersistCredentials(src)).toBeNull()
  })
})

describe('removePathsGlobs', () => {
  const SRC = [
    'on:',
    '  push:',
    '    paths:',
    "      - '**/*.php'",
    "      - 'composer.json'",
    "      - 'composer.lock'",
    "      - 'psalm.xml'",
    '  pull_request:',
    '    paths:',
    "      - 'composer.lock'",
    "      - 'psalm.xml'",
    'jobs: {}',
    ''
  ].join('\n')

  test('видаляє лише задані глоби в обох paths-блоках, решту лишає', () => {
    const out = removePathsGlobs(SRC, new Set(['composer.lock', 'psalm.xml']))
    expect(out).not.toMatch(/composer\.lock/u)
    expect(out).not.toMatch(/psalm\.xml/u)
    expect(out).toMatch(/\*\*\/\*\.php/u)
    expect(out).toMatch(/composer\.json/u)
  })

  test('значення поза paths-блоком не зачіпається', () => {
    const src = [
      'env:',
      "  X: 'composer.lock'",
      'on:',
      '  push:',
      '    paths:',
      "      - 'composer.lock'",
      'jobs: {}',
      ''
    ].join('\n')
    const out = removePathsGlobs(src, new Set(['composer.lock']))
    expect(out).toMatch(/X: 'composer\.lock'/u) // env лишився
    expect(out.match(/composer\.lock/gu)).toHaveLength(1) // лише в env
  })

  test('нема збігів → null', () => {
    expect(removePathsGlobs(SRC, new Set(['nope.toml']))).toBeNull()
  })
})

describe('patterns (інтеграція на temp-файлах)', () => {
  /**
   * Виконує `fn(dir)` у свіжому temp-каталозі й гарантовано прибирає його.
   * @param {(dir: string) => unknown} fn тіло тесту
   * @returns {unknown} результат `fn`
   */
  function withTmp(fn) {
    const dir = mkdtempSync(join(tmpdir(), 'gawf-'))
    try {
      return fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  test('checkout-persist-credentials: test+apply пише файл', () =>
    withTmp(dir => {
      const rel = 'wf.yml'
      writeFileSync(join(dir, rel), ['      - uses: actions/checkout@v6', ''].join('\n'))
      const violations = [
        {
          ruleId: 'ga',
          concernId: 'workflows',
          reason: 'checkout-persist-credentials',
          message: 'x',
          file: rel,
          data: { kind: 'checkout-persist-credentials' }
        }
      ]
      const p = patterns.find(x => x.id === 'ga-workflows-checkout-persist-credentials')
      expect(p.test(violations)).toBe(true)
      const res = p.apply(violations, { cwd: dir, ruleId: 'ga', concernId: 'workflows' })
      expect(res.touchedFiles).toHaveLength(1)
      expect(readFileSync(join(dir, rel), 'utf8')).toMatch(/persist-credentials: false/u)
    }))

  test('unmatched-paths-glob: прибирає glob лише в адресованому файлі', () =>
    withTmp(dir => {
      const rel = 'lint-php.yml'
      writeFileSync(
        join(dir, rel),
        ['on:', '  push:', '    paths:', "      - 'psalm.xml'", "      - '**/*.php'", 'jobs: {}', ''].join('\n')
      )
      const violations = [
        {
          ruleId: 'ga',
          concernId: 'workflows',
          reason: 'unmatched-paths-glob',
          message: 'x',
          file: rel,
          data: { kind: 'unmatched-paths-glob', event: 'push', glob: 'psalm.xml' }
        }
      ]
      const p = patterns.find(x => x.id === 'ga-workflows-unmatched-paths-glob')
      expect(p.test(violations)).toBe(true)
      const res = p.apply(violations, { cwd: dir, ruleId: 'ga', concernId: 'workflows' })
      expect(res.touchedFiles).toHaveLength(1)
      const txt = readFileSync(join(dir, rel), 'utf8')
      expect(txt).not.toMatch(/psalm\.xml/u)
      expect(txt).toMatch(/\*\*\/\*\.php/u)
    }))

  test('test=false коли нема відповідного data.kind', () => {
    const foreign = [{ ruleId: 'ga', concernId: 'workflows', reason: 'other', message: 'x' }]
    for (const p of patterns) expect(p.test(foreign)).toBe(false)
  })
})
