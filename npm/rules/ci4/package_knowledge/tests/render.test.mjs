import { describe, expect, test } from 'vitest'

import { renderKnowledgeArtifacts } from '../render.mjs'
import { zoneHash } from '../zones.mjs'

const DOMAIN_ID = 'npm:@fixture/orders'
const PUBLIC_ID = `code-unit:${DOMAIN_ID}:js:src/orders.mjs#submitOrder`
const PRIVATE_ID = `code-unit:${DOMAIN_ID}:js:src/orders.mjs#persistOrder`
const OUTCOME_ID = 'outcome:created'
const CONTRACT_ID = 'contract:payments'

/**
 * Створює graph із public flow, private implementation та explicit gap.
 * @param {{gap?: boolean, topics?: Array<Record<string, unknown>>}} [options] graph variations
 * @returns {Record<string, unknown>} deterministic rendering fixture
 */
function graphFixture({ gap = true, topics } = {}) {
  return {
    schemaVersion: 1,
    domain: {
      id: DOMAIN_ID,
      ecosystem: 'npm',
      name: '@fixture/orders',
      rootManifest: 'package.json',
      sourceFingerprint: 'sha256:domain'
    },
    nodes: [
      {
        id: PUBLIC_ID,
        kind: 'code-unit',
        name: 'submitOrder',
        visibility: 'public',
        domainId: DOMAIN_ID,
        attributes: { sourcePath: 'src/orders.mjs' },
        sourceFingerprint: 'sha256:public'
      },
      {
        id: PRIVATE_ID,
        kind: 'code-unit',
        name: 'persistOrder',
        visibility: 'private',
        domainId: DOMAIN_ID,
        attributes: { sourcePath: 'src/persistence.mjs' },
        sourceFingerprint: 'sha256:private'
      },
      {
        id: OUTCOME_ID,
        kind: 'outcome',
        name: 'Order created',
        visibility: 'public',
        domainId: DOMAIN_ID,
        attributes: {},
        sourceFingerprint: 'sha256:outcome'
      },
      {
        id: CONTRACT_ID,
        kind: 'integration',
        name: 'payments',
        visibility: 'external',
        domainId: DOMAIN_ID,
        attributes: {},
        sourceFingerprint: 'sha256:contract'
      }
    ],
    edges: [{ id: 'edge:public', fromId: PUBLIC_ID, toId: OUTCOME_ID, kind: 'produces', evidenceIds: ['e:public'] }],
    claims: [
      {
        id: 'claim:implemented',
        subjectId: PUBLIC_ID,
        layer: 'implemented',
        predicate: 'creates-order',
        value: true,
        evidenceIds: ['e:public'],
        confidence: 1,
        sourceFingerprint: 'sha256:claim'
      },
      {
        id: 'claim:expected',
        subjectId: PUBLIC_ID,
        layer: 'expected',
        predicate: 'creates-order',
        value: true,
        evidenceIds: ['e:public'],
        confidence: 1,
        sourceFingerprint: 'sha256:expected'
      }
    ],
    topics: topics ?? [
      { id: 'process:orders', kind: 'process', title: 'submitOrder', domainId: DOMAIN_ID, anchorIds: [PUBLIC_ID] },
      { id: 'contract:orders', kind: 'contract', title: 'payments', domainId: DOMAIN_ID, anchorIds: [CONTRACT_ID] }
    ],
    gaps: gap
      ? [
          {
            id: 'gap:expected',
            status: 'missing',
            expectedClaimId: 'claim:expected',
            implementedClaimIds: [],
            evidenceIds: ['e:public']
          }
        ]
      : [],
    evidence: [
      { id: 'e:public', kind: 'code', path: 'src/orders.mjs', symbolId: PUBLIC_ID, contentHash: 'sha256:evidence' }
    ]
  }
}

describe('renderKnowledgeArtifacts', () => {
  test('renders only meaningful views, an actionable gaps page and schema-compatible manifest', () => {
    const result = renderKnowledgeArtifacts({ graph: graphFixture() })

    expect(result).toMatchObject({ ok: true })
    expect(Object.keys(result.files).toSorted()).toEqual([
      'docs/.docgen/manifest.json',
      'docs/explanation/architecture.md',
      'docs/explanation/processes/dcfd264583ed8d3acfe0e103.md',
      'docs/implementation-gaps.md',
      'docs/index.md',
      'docs/reference/contracts/2e0b0c95a18292880dfd62a0.md'
    ])
    expect(result.files['docs/.docgen/manifest.json']).toContain(PRIVATE_ID)
    expect(result.files['docs/implementation-gaps.md']).toContain('Status: missing')
    expect(result.files['docs/explanation/architecture.md']).toContain('```mermaid')
    expect(result.files['docs/explanation/processes/dcfd264583ed8d3acfe0e103.md']).toContain('creates-order: true.')
    expect(result.files['docs/explanation/processes/dcfd264583ed8d3acfe0e103.md']).toContain('`src/orders.mjs`')
  })

  test('renders a dedicated capability page when a deterministic topic supplies one', () => {
    const capability = {
      id: 'capability:orders',
      kind: 'capability',
      title: 'Order intake',
      domainId: DOMAIN_ID,
      anchorIds: [PUBLIC_ID]
    }
    const result = renderKnowledgeArtifacts({ graph: graphFixture({ topics: [capability] }) })

    expect(Object.keys(result.files).some(path => path.startsWith('docs/explanation/capabilities/'))).toBe(true)
  })

  test('is byte-deterministic and does not create empty page trees or gaps without an explicit gap', () => {
    const graph = graphFixture({ gap: false, topics: [] })
    const first = renderKnowledgeArtifacts({ graph })
    const second = renderKnowledgeArtifacts({ graph: structuredClone(graph) })

    expect(first).toEqual(second)
    expect(Object.keys(first.files).toSorted()).toEqual([
      'docs/.docgen/manifest.json',
      'docs/explanation/architecture.md',
      'docs/index.md'
    ])
    expect(JSON.stringify(first.files)).not.toContain('2026-')
  })

  test('does not leak private names into human Markdown', () => {
    const result = renderKnowledgeArtifacts({ graph: graphFixture() })
    const markdown = Object.entries(result.files)
      .filter(([path]) => path.endsWith('.md'))
      .map(([, content]) => content)
      .join('\n')

    expect(markdown).not.toContain('persistOrder')
    expect(markdown).not.toContain(PRIVATE_ID)
  })

  test('renders a detailed planning fragment from behavioral claims while keeping private facts semantic-only', () => {
    const graph = graphFixture()
    graph.edges.push(
      { id: 'edge:private', fromId: PUBLIC_ID, toId: PRIVATE_ID, kind: 'invokes', evidenceIds: ['e:public'] },
      { id: 'edge:private-outcome', fromId: PRIVATE_ID, toId: OUTCOME_ID, kind: 'produces', evidenceIds: ['e:public'] }
    )
    graph.claims.push(
      {
        id: 'claim:purpose',
        subjectId: PUBLIC_ID,
        layer: 'implemented',
        predicate: 'purpose',
        value: 'Приймає замовлення клієнта.',
        evidenceIds: ['e:public'],
        confidence: 1
      },
      {
        id: 'claim:trigger',
        subjectId: PUBLIC_ID,
        layer: 'implemented',
        predicate: 'trigger',
        value: 'HTTP запит на створення замовлення.',
        evidenceIds: ['e:public'],
        confidence: 1
      },
      {
        id: 'claim:rule',
        subjectId: PUBLIC_ID,
        layer: 'implemented',
        predicate: 'business-rule',
        value: 'Замовлення приймається лише після перевірки даних.',
        evidenceIds: ['e:public'],
        confidence: 1
      },
      {
        id: 'claim:private-state',
        subjectId: PRIVATE_ID,
        layer: 'implemented',
        predicate: 'state-change',
        value: 'Підтверджений стан замовлення зберігається.',
        evidenceIds: ['e:public'],
        confidence: 1
      }
    )

    const result = renderKnowledgeArtifacts({ graph })
    const process = result.files['docs/explanation/processes/dcfd264583ed8d3acfe0e103.md']

    expect(process).toContain('## Призначення')
    expect(process).toContain('## Trigger')
    expect(process).toContain('## Business rules')
    expect(process).toContain('## Зміни стану')
    expect(process).toContain('Підтверджений стан замовлення зберігається.')
    expect(process).not.toContain('persistOrder')
  })

  test('uses architecture claims for configuration, persistence, integration and state', () => {
    const graph = graphFixture()
    graph.claims.push(
      {
        id: 'claim:config',
        subjectId: PUBLIC_ID,
        layer: 'implemented',
        predicate: 'config',
        value: 'Використовує конфігурацію платіжного провайдера.',
        evidenceIds: ['e:public'],
        confidence: 1
      },
      {
        id: 'claim:persistence',
        subjectId: PUBLIC_ID,
        layer: 'implemented',
        predicate: 'persistence',
        value: 'Зберігає підтверджене замовлення.',
        evidenceIds: ['e:public'],
        confidence: 1
      },
      {
        id: 'claim:integration',
        subjectId: PUBLIC_ID,
        layer: 'implemented',
        predicate: 'integration',
        value: 'Передає платіж у зовнішній контракт.',
        evidenceIds: ['e:public'],
        confidence: 1
      },
      {
        id: 'claim:state',
        subjectId: PUBLIC_ID,
        layer: 'implemented',
        predicate: 'state-change',
        value: 'Позначає замовлення створеним.',
        evidenceIds: ['e:public'],
        confidence: 1
      }
    )

    const result = renderKnowledgeArtifacts({ graph })
    const architecture = result.files['docs/explanation/architecture.md']

    expect(architecture).toContain('## Configuration')
    expect(architecture).toContain('## Persistence')
    expect(architecture).toContain('## Integration boundaries')
    expect(architecture).toContain('## Зміни стану')
  })

  test('updates AUTOGEN while preserving supplied MANUAL and EXPECTED zones', () => {
    const old =
      'Manual prefix\n<!-- MANUAL:start id="context" -->Preserve this.<!-- MANUAL:end id="context" -->\n<!-- EXPECTED:start id="must-create" -->Expected behavior.<!-- EXPECTED:end id="must-create" -->\n<!-- AUTOGEN:start id="package-index" hash="' +
      zoneHash('old') +
      '" -->old<!-- AUTOGEN:end id="package-index" -->'
    const result = renderKnowledgeArtifacts({ graph: graphFixture(), existingFiles: { 'docs/index.md': old } })

    expect(result).toMatchObject({ ok: true })
    expect(result.files['docs/index.md']).toContain('Preserve this.')
    expect(result.files['docs/index.md']).toContain('Expected behavior.')
    expect(result.files['docs/index.md']).not.toContain('>old<')
  })

  test('fails closed when an authored page has no declared AUTOGEN target', () => {
    const result = renderKnowledgeArtifacts({
      graph: graphFixture(),
      existingFiles: { 'docs/index.md': '# Handwritten' }
    })

    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: 'autogen-zone-required', path: 'docs/index.md' }] })
  })
})
