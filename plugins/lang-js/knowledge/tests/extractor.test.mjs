import { describe, expect, test } from 'vitest'
import { Buffer } from 'node:buffer'

import { buildNormalizedGraph } from '../../../../npm/rules/ci4/package_knowledge/normalized-graph.mjs'
import jsKnowledgeExtractor, { analyzeFile } from '../extractor.mjs'

/**
 * Створює test input для knowledge extractor.
 * @param {string} path source path
 * @param {string} content source content
 * @returns {{ domain: object, file: { path: string, content: string, contentHash: string } }} adapter input
 */
function input(path, content) {
  return { domain: { id: 'npm:@fixture/app' }, file: { path, content, contentHash: `hash:${path}` } }
}

describe('knowledge.extractor@1 JS adapter', () => {
  test('декларує versioned parser contract і всі JS/Vue extensions', () => {
    expect(jsKnowledgeExtractor).toMatchObject({
      id: 'knowledge-js',
      apiVersion: 1,
      parser: { id: 'oxc+vue-sfc', grammarVersion: 'oxc-0.137.0' }
    })
    expect(jsKnowledgeExtractor.extensions).toEqual(['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx', '.vue'])
  })

  test('будує units, imports, internal/opaque edges, chunks і coverage з UTF-8 byte spans', () => {
    const content = [
      "import { charge } from '@fixture/payments'",
      'export function submit(замовлення) {',
      '  return persist(замовлення) + charge(замовлення)',
      '}',
      'const persist = value => value.id',
      'class Internal {}'
    ].join('\n')
    const result = analyzeFile(input('src/submit.mjs', content))

    expect(result).toMatchObject({ ok: true, file: { path: 'src/submit.mjs', language: 'js' } })
    expect(result.units.map(unit => unit.name)).toEqual(['submit', 'persist', 'Internal'])
    expect(result.units.find(unit => unit.name === 'submit').span.startByte).toBe(
      Buffer.byteLength(content.slice(0, content.indexOf('function submit')), 'utf8')
    )
    expect(result.units.find(unit => unit.name === 'submit').span.endByte).toBeGreaterThan(
      content.indexOf('}', content.indexOf('function submit'))
    )
    expect(result.edges).toEqual([
      expect.objectContaining({
        kind: 'integrates',
        fromLocalId: 'unit:submit:0',
        to: { unresolvedSpecifier: '@fixture/payments', opaque: true }
      }),
      expect.objectContaining({ kind: 'invokes', fromLocalId: 'unit:submit:0', to: { localId: 'unit:persist:0' } })
    ])
    expect(result.imports).toEqual([expect.objectContaining({ specifier: '@fixture/payments' })])
    expect(result.entryPoints).toEqual([{ localId: 'unit:submit:0', reason: 'export' }])
    expect(result.chunks).toHaveLength(3)
    expect(result.coverage).toMatchObject({ requiredUnits: 3, coveredUnits: 3, requiredEdges: 2, complete: true })
    expect(
      buildNormalizedGraph({
        domain: {
          id: 'npm:@fixture/app',
          ecosystem: 'npm',
          name: '@fixture/app',
          rootManifest: 'package.json',
          sourceFingerprint: 'sha256:domain'
        },
        fragments: [result]
      }).ok
    ).toBe(true)
  })

  test('OXC parse error блокує publication без partial graph або fallback', () => {
    const result = analyzeFile(input('src/broken.ts', 'export const value = ('))
    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'parse-error', path: 'src/broken.ts' })]
    })
    expect(result).not.toHaveProperty('units')
  })

  test('Vue script setup проходить через compiler-sfc і OXC, зберігаючи spans оригінального SFC', () => {
    const content = '<script setup lang="ts">\nexport const save = input => input\n</script>'
    const result = analyzeFile(input('src/Card.vue', content))
    expect(result).toMatchObject({ ok: true, file: { language: 'vue' } })
    expect(result.units).toEqual([expect.objectContaining({ name: 'save', visibility: 'public' })])
    expect(result.units[0].span.startByte).toBeGreaterThan(content.indexOf('<script'))
  })

  test('Vue template утворює units та edges для unicode handler, local call і component boundary', () => {
    const content = [
      '<template>',
      '  <UiCard @save="зберегти($event)" :title="заголовок">{{ renderTitle(замовлення) }}</UiCard>',
      '</template>',
      '<script setup>',
      'import { track } from \'@fixture/analytics\'',
      'export const зберегти = order => track(order)',
      'const renderTitle = order => order.name',
      'const заголовок = \'Замовлення\'',
      'const замовлення = {}',
      '</script>'
    ].join('\n')
    const result = analyzeFile(input('src/Card.vue', content))
    const handler = result.units.find(unit => unit.kind === 'template-directive' && unit.name === '@save')
    expect(result).toMatchObject({ ok: true, coverage: { complete: true, requiredUnits: 6, requiredEdges: 4 } })
    expect(handler).toMatchObject({ localId: 'template:directive:0', attributes: { directive: 'on', argument: 'save' } })
    expect(result.entryPoints).toContainEqual({ localId: handler.localId, reason: 'template-event:save' })
    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'triggers',
          fromLocalId: handler.localId,
          to: { localId: 'unit:зберегти:0' },
          evidence: expect.arrayContaining([
            expect.objectContaining({
              span: expect.objectContaining({
                startByte: Buffer.byteLength(content.slice(0, content.indexOf('зберегти($event)')), 'utf8')
              })
            })
          ])
        }),
        expect.objectContaining({
          kind: 'invokes',
          fromLocalId: 'template:interpolation:0',
          to: { localId: 'unit:renderTitle:0' }
        }),
        expect.objectContaining({
          kind: 'integrates',
          fromLocalId: 'template:component:0',
          to: { unresolvedSpecifier: 'vue-component:UiCard', opaque: true }
        })
      ])
    )
    expect(buildNormalizedGraph({
      domain: {
        id: 'npm:@fixture/app',
        ecosystem: 'npm',
        name: '@fixture/app',
        rootManifest: 'package.json',
        sourceFingerprint: 'sha256:domain'
      },
      fragments: [result]
    }).ok).toBe(true)
  })

  test('Vue malformed template повертає blocking parser diagnostic без partial graph', () => {
    const content = '<template><UiCard></template><script setup>const save = () => true</script>'
    const result = analyzeFile(input('src/Card.vue', content))
    expect(result).toEqual({
      ok: false,
      diagnostics: [expect.objectContaining({ code: 'vue-sfc-parse-error', path: 'src/Card.vue' })]
    })
    expect(result).not.toHaveProperty('units')
  })
})
