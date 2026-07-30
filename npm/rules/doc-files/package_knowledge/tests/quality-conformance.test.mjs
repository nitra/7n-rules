/** Golden CI4 conformance corpus for package-knowledge quality gates. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { evaluateGaps } from '../gap-engine.mjs'
import { createImpactSlice } from '../impact.mjs'
import { renderKnowledgeArtifacts } from '../render.mjs'
import { discoverTopics } from '../topic-discovery.mjs'
import { validateKnowledgeGraph } from '../validator.mjs'

const FIXTURES_DIR = join(import.meta.dirname, 'fixtures', 'quality')

/**
 * Читає committed JSON fixture через absolute test-directory path.
 * @param {string} name fixture file name
 * @returns {Promise<Record<string, unknown>>} parsed fixture
 */
async function readFixture(name) {
  return JSON.parse(await readFile(join(FIXTURES_DIR, name), 'utf8'))
}

/**
 * Додає discovered topics до fixture graph, не змінюючи canonical fixture bytes.
 * @param {Record<string, unknown>} graph fixture graph
 * @returns {Record<string, unknown>} render-ready graph
 */
function graphWithTopics(graph) {
  const candidate = structuredClone(graph)
  return { ...candidate, topics: discoverTopics(candidate) }
}

/**
 * Повертає gap-engine graph для одного scenario з explicit expectation за потреби.
 * @param {Record<string, unknown>} corpus corpus fixture
 * @param {Record<string, unknown>} scenario requested scenario
 * @returns {Record<string, unknown>} scenario graph
 */
function graphForGapScenario(corpus, scenario) {
  const graph = structuredClone(corpus.baseGraph)
  if (scenario.withExpectation !== true) return graph
  graph.claims.push(structuredClone(corpus.expectedClaim))
  const implemented = graph.claims.find(claim => claim.id === 'claim:implemented:accepts-order')
  if (typeof scenario.implementedConfidence === 'number') implemented.confidence = scenario.implementedConfidence
  return graph
}

describe('package-knowledge golden quality conformance', () => {
  test('Changeability Test recalls every required impact and cannot escape its documentation domain', async () => {
    const fixture = await readFixture('changeability.json')
    const graph = graphWithTopics(fixture.graph)
    const [topic] = graph.topics
    const result = createImpactSlice({ graph, topics: graph.topics, topicId: topic.id })

    expect(result).toMatchObject({ ok: true, slice: { domain: { id: fixture.domainId } } })
    expect(result.slice.files).toEqual(fixture.requiredImpact.files)
    expect(result.slice.tests).toEqual(fixture.requiredImpact.tests)
    expect(result.slice.contracts).toEqual(fixture.requiredImpact.contracts)
    expect(result.slice.configs).toEqual(fixture.requiredImpact.configs)
    expect(JSON.stringify(result.slice)).not.toContain(fixture.privateSymbolName)
    expect(JSON.stringify(result.slice)).not.toContain('../catalog')
  })

  test('Gap Test matches every accepted deterministic scenario and keeps failures as blockers', async () => {
    const corpus = await readFixture('gap-scenarios.json')

    for (const scenario of corpus.scenarios) {
      const result = evaluateGaps({
        graph: graphForGapScenario(corpus, scenario),
        mappings: scenario.mappings ?? [],
        validation: scenario.validation ?? {}
      })

      if (scenario.expectedBlocker) {
        expect(result).toEqual({
          ok: false,
          diagnostics: [expect.objectContaining({ code: scenario.expectedBlocker })]
        })
      } else if (scenario.expectedGaps) {
        expect(result).toEqual({ ok: true, gaps: scenario.expectedGaps })
      } else {
        expect(result).toEqual({
          ok: true,
          gaps: [expect.objectContaining({ status: scenario.expectedStatus })]
        })
      }
    }
  })

  test('validator blocks parser and coverage failures before a human projection can be published', async () => {
    const fixture = await readFixture('changeability.json')
    const graph = graphWithTopics(fixture.graph)
    const rendered = renderKnowledgeArtifacts({ graph })
    const humanProjection = Object.entries(rendered.files)
      .filter(([path]) => path.endsWith('.md'))
      .map(([, content]) => content)
      .join('\n')

    await expect(validateKnowledgeGraph({ graph, fragments: [{ ok: false }], humanProjection })).resolves.toMatchObject(
      { ok: false, diagnostics: [expect.objectContaining({ code: 'extractor-fragment-failed' })] }
    )
    await expect(
      validateKnowledgeGraph({
        graph,
        fragments: [
          {
            ...fixture.completeFragments[0],
            coverage: { ...fixture.completeFragments[0].coverage, coveredEdges: 3, complete: false }
          }
        ],
        humanProjection
      })
    ).resolves.toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: 'coverage-incomplete' })] })
  })

  test('human projection preserves privacy and full plus incremental rendering is byte-equivalent', async () => {
    const fixture = await readFixture('changeability.json')
    const graph = graphWithTopics(fixture.graph)
    const full = renderKnowledgeArtifacts({ graph })
    const incremental = renderKnowledgeArtifacts({ graph: structuredClone(graph), existingFiles: full.files })
    const humanProjection = Object.entries(full.files)
      .filter(([path]) => path.endsWith('.md'))
      .map(([, content]) => content)
      .join('\n')

    expect(full).toMatchObject({ ok: true })
    expect(incremental).toEqual(full)
    expect(humanProjection).not.toContain(fixture.privateSymbolName)
    await expect(
      validateKnowledgeGraph({ graph, fragments: fixture.completeFragments, humanProjection })
    ).resolves.toEqual({ ok: true, diagnostics: [] })
    await expect(
      validateKnowledgeGraph({
        graph,
        fragments: fixture.completeFragments,
        humanProjection: `${humanProjection}\n${fixture.privateSymbolName}`
      })
    ).resolves.toMatchObject({ ok: false, diagnostics: [expect.objectContaining({ code: 'private-symbol-leak' })] })
  })
})
