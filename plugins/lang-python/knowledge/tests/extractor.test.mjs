import { Buffer } from 'node:buffer'

import { describe, expect, test } from 'vitest'

import { buildNormalizedGraph } from '../../../../npm/rules/doc-files/package_knowledge/normalized-graph.mjs'
import pythonKnowledgeExtractor, { analyzeFile, collectTestScenarios } from '../extractor.mjs'

/**
 * Створює test input для Python knowledge extractor.
 * @param {string} path source path
 * @param {string} content source content
 * @returns {{ domain: object, file: { path: string, content: string, contentHash: string } }} adapter input
 */
function input(path, content) {
  return { domain: { id: 'python:fixture-app' }, file: { path, content, contentHash: `hash:${path}` } }
}

describe('knowledge.extractor@1 Python adapter', () => {
  test('декларує Tree-sitter WASM parser contract і Python extension', () => {
    expect(pythonKnowledgeExtractor).toMatchObject({
      id: 'knowledge-python',
      apiVersion: 1,
      parser: { id: 'tree-sitter-python-wasm', grammarVersion: 'tree-sitter-python-0.25.0' }
    })
    expect(pythonKnowledgeExtractor.extensions).toEqual(['.py'])
  })

  test('будує public/private units, imports, semantic edges, chunks і coverage з UTF-8 byte spans', async () => {
    const content = [
      'import gateway as gw',
      'from payments.api import charge',
      '',
      'def submit(замовлення):',
      '    _persist(замовлення)',
      '    gw.send(замовлення)',
      '    return charge(замовлення)',
      '',
      'def _persist(value):',
      '    return value',
      '',
      'class Receipt:',
      '    def render(self):',
      '        return submit(self)'
    ].join('\n')
    const result = await analyzeFile(input('src/submit.py', content))

    expect(result).toMatchObject({ ok: true, file: { path: 'src/submit.py', language: 'python' } })
    expect(result.units.map(unit => [unit.name, unit.visibility])).toEqual([
      ['submit', 'public'],
      ['_persist', 'private'],
      ['Receipt', 'public'],
      ['render', 'public']
    ])
    expect(result.units.find(unit => unit.name === 'submit').span.startByte).toBe(
      Buffer.byteLength(content.slice(0, content.indexOf('def submit')), 'utf8')
    )
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'integrates',
          fromLocalId: expect.stringContaining('submit'),
          to: { unresolvedSpecifier: 'gateway', opaque: true }
        }),
        expect.objectContaining({
          kind: 'integrates',
          fromLocalId: expect.stringContaining('submit'),
          to: { unresolvedSpecifier: 'payments.api.charge', opaque: true }
        }),
        expect.objectContaining({ kind: 'invokes', fromLocalId: expect.stringContaining('submit') }),
        expect.objectContaining({ kind: 'invokes', fromLocalId: expect.stringContaining('Receipt.render') })
      ])
    )
    expect(result.imports).toEqual([
      expect.objectContaining({ specifier: 'gateway' }),
      expect.objectContaining({ specifier: 'payments.api' })
    ])
    expect(result.entryPoints).toEqual([
      expect.objectContaining({ localId: expect.stringContaining('submit'), reason: 'public-module-symbol' }),
      expect.objectContaining({ localId: expect.stringContaining('Receipt'), reason: 'public-module-symbol' })
    ])
    expect(result.chunks).toHaveLength(4)
    expect(result.coverage).toEqual({
      requiredUnits: 4,
      coveredUnits: 4,
      requiredEdges: 4,
      coveredEdges: 4,
      complete: true
    })
    expect(
      buildNormalizedGraph({
        domain: {
          id: 'python:fixture-app',
          ecosystem: 'python',
          name: 'fixture-app',
          rootManifest: 'pyproject.toml',
          sourceFingerprint: 'sha256:domain'
        },
        fragments: [result]
      }).ok
    ).toBe(true)
  })

  test('parser error блокує publication без partial graph або fallback', async () => {
    const result = await analyzeFile(input('src/broken.py', 'def broken(:\n    return 1\n'))
    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'parse-error', path: 'src/broken.py' })]
    })
    expect(result).not.toHaveProperty('units')
  })

  test('unsupported source extension та wildcard import мають blocking diagnostics', async () => {
    await expect(analyzeFile(input('src/module.txt', 'value = 1'))).resolves.toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'unsupported-extension', path: 'src/module.txt' })]
    })
    await expect(analyzeFile(input('src/wildcard.py', 'from integrations import *\n'))).resolves.toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'unsupported-import-syntax', path: 'src/wildcard.py' })]
    })
  })

  test('збирає лише active Python assertions як explicit Expected scenarios', async () => {
    const content = [
      'def test_accepts_order():',
      '    assert submit()',
      '',
      '@pytest.mark.skip',
      'def test_skipped_order():',
      '    assert submit()',
      '',
      'def helper():',
      '    assert submit()'
    ].join('\n')

    await expect(collectTestScenarios({ file: { path: 'tests/test_orders.py', content } })).resolves.toEqual({
      ok: true,
      scenarios: [
        expect.objectContaining({
          anchor: 'test_accepts_order',
          content: expect.stringContaining('assert submit()')
        })
      ]
    })
  })
})
