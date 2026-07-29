/**
 * Рендерить deterministic Markdown і manifest-проєкції package knowledge graph.
 *
 * Модуль не аналізує source, не викликає LLM і не публікує файли. Він створює
 * повний candidate file map, а publication лишається відповідальністю
 * `publish.mjs` після окремої validation-перевірки.
 */

import { createHash } from 'node:crypto'

import { createImpactSlice } from './impact.mjs'
import { serializeKnowledgeGraph } from './normalized-graph.mjs'
import { collectReachableNodeIds } from './topic-discovery.mjs'
import { applyAutogenUpdates, parseKnowledgeZones, zoneHash } from './zones.mjs'

const MANIFEST_PATH = 'docs/.docgen/manifest.json'
const PAGE_KIND_PATHS = {
  capability: 'docs/explanation/capabilities',
  contract: 'docs/reference/contracts',
  process: 'docs/explanation/processes'
}
const PAGE_KIND_LABELS = {
  capability: 'Можливість',
  contract: 'Контракт',
  process: 'Процес'
}
const CLAIM_SECTION_TITLES = Object.freeze({
  purpose: 'Призначення',
  actor: 'Actors',
  trigger: 'Trigger',
  precondition: 'Передумови',
  step: 'Основний потік',
  'business-rule': 'Business rules',
  'state-change': 'Зміни стану',
  integration: 'Integration boundaries',
  outcome: 'Результати',
  'alternative-flow': 'Alternative flows',
  'error-flow': 'Error flows',
  responsibility: 'Відповідальності',
  config: 'Configuration',
  persistence: 'Persistence'
})

/**
 * Створює stable renderer diagnostic.
 * @param {string} code machine-readable code
 * @param {string} detail explanation
 * @param {string | null} [path] affected candidate path
 * @returns {{code: string, detail: string, path: string | null}} diagnostic
 */
function diagnostic(code, detail, path = null) {
  return { code, detail, path }
}

/**
 * Повертає короткий filesystem-safe stable topic token.
 * @param {string} topicId canonical topic ID
 * @returns {string} path-safe deterministic token
 */
function topicToken(topicId) {
  return createHash('sha256').update(topicId).digest('hex').slice(0, 24)
}

/**
 * Порівнює strings у стабільному порядку.
 * @param {string} left first value
 * @param {string} right second value
 * @returns {number} comparison result
 */
function compareStrings(left, right) {
  return left.localeCompare(right)
}

/**
 * Рекурсивно canonicalizes object keys for byte-stable manifest JSON.
 * @param {unknown} value serializable value
 * @returns {unknown} canonical value
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(item => canonicalize(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => compareStrings(left, right))
      .map(([key, item]) => [key, canonicalize(item)])
  )
}

/**
 * Sorts graph collections without changing their schema or traceability data.
 * @param {Record<string, unknown>} graph source knowledge graph
 * @returns {Record<string, unknown>} manifest-ready graph
 */
function canonicalGraph(graph) {
  const output = canonicalize(graph)
  for (const key of ['nodes', 'edges', 'claims', 'topics', 'gaps', 'evidence']) {
    if (Array.isArray(output[key]))
      output[key] = output[key].toSorted((left, right) => compareStrings(left.id, right.id))
  }
  return output
}

/**
 * Reads only human-safe node titles. Private symbols remain manifest-only.
 * @param {Record<string, unknown>} graph knowledge graph
 * @returns {Set<string>} private names and IDs that may not occur in Markdown
 */
function privateNames(graph) {
  return new Set(
    (Array.isArray(graph.nodes) ? graph.nodes : [])
      .filter(node => node?.visibility === 'private')
      .flatMap(node => [node.name, node.id].filter(value => typeof value === 'string' && value !== ''))
  )
}

/**
 * Returns a display string only when it cannot leak a private symbol name.
 * @param {unknown} value candidate text
 * @param {Set<string>} hiddenNames private names
 * @param {string} fallback safe replacement
 * @returns {string} privacy-safe text
 */
function safeText(value, hiddenNames, fallback) {
  if (typeof value !== 'string' || value === '' || [...hiddenNames].some(name => value.includes(name))) return fallback
  return value
}

/**
 * Serializes an evidence-backed claim value without leaking private symbols.
 * @param {unknown} value structured claim value
 * @param {Set<string>} hiddenNames private names
 * @returns {string} safe compact value
 */
function safeValue(value, hiddenNames) {
  const rendered = typeof value === 'string' ? value : JSON.stringify(canonicalize(value))
  return safeText(rendered, hiddenNames, 'підтверджене значення')
}

/**
 * Wraps generated content in an AUTOGEN zone with a stable hash.
 * @param {string} id zone ID
 * @param {string} content generated Markdown
 * @returns {string} complete Markdown zone
 */
function autogenZone(id, content) {
  return `<!-- AUTOGEN:start id="${id}" hash="${zoneHash(content)}" -->${content}<!-- AUTOGEN:end id="${id}" -->`
}

/**
 * Updates an existing explicitly zoned page or creates a new generated page.
 * @param {{path: string, zoneId: string, content: string, existing: string | undefined}} input page projection
 * @returns {{ok: true, markdown: string} | {ok: false, diagnostics: Array<Record<string, unknown>>}} rendered page
 */
function renderPage({ path, zoneId, content, existing }) {
  if (existing === undefined) return { ok: true, markdown: autogenZone(zoneId, content) }
  if (typeof existing !== 'string') {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-existing-page', 'Existing page має бути Markdown string.', path)]
    }
  }
  const parsed = parseKnowledgeZones(existing, path)
  if (!parsed.ok) return parsed
  const zone = parsed.zones.find(item => item.kind === 'AUTOGEN' && item.id === zoneId)
  if (!zone) {
    return {
      ok: false,
      diagnostics: [diagnostic('autogen-zone-required', `Existing page має містити AUTOGEN ${zoneId}.`, path)]
    }
  }
  return applyAutogenUpdates(existing, { [zoneId]: content }, path)
}

/**
 * Returns graph topics that have a supported dedicated Markdown page.
 * @param {Record<string, unknown>} graph knowledge graph
 * @returns {Array<Record<string, unknown>>} sorted page topics
 */
function pageTopics(graph) {
  return (Array.isArray(graph.topics) ? graph.topics : [])
    .filter(topic => topic && Object.hasOwn(PAGE_KIND_PATHS, topic.kind) && typeof topic.id === 'string')
    .toSorted((left, right) => compareStrings(left.id, right.id))
}

/**
 * Groups a stable topic list by kind for index navigation.
 * @param {Array<Record<string, unknown>>} topics rendered topics
 * @returns {Map<string, Array<Record<string, unknown>>>} kind → topics
 */
function topicsByKind(topics) {
  const result = new Map()
  for (const topic of topics) {
    const items = result.get(topic.kind) ?? []
    items.push(topic)
    result.set(topic.kind, items)
  }
  return result
}

/**
 * Determines whether graph evidence supports a useful architecture projection.
 * @param {Record<string, unknown>} graph knowledge graph
 * @returns {boolean} whether architecture page is meaningful
 */
function needsArchitecture(graph) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const responsibilities = nodes.filter(node => node?.domainId === graph.domain.id && node.kind === 'component')
  const boundaries = nodes.filter(
    node => node?.domainId === graph.domain.id && node.kind === 'integration' && node.visibility === 'external'
  )
  return responsibilities.length > 1 || boundaries.length > 0
}

/**
 * Renders a compact fact list or an explicit absence statement.
 * @param {string[]} facts evidence-backed facts
 * @param {string} fallback absence text
 * @returns {string} Markdown list or fallback
 */
function factList(facts, fallback) {
  return facts.length > 0 ? facts.map(fact => `- ${fact}`).join('\n') : fallback
}

/** Рендерить тільки присутні evidence-backed claim categories у stable order. */
function claimSections(claims, hiddenNames, fallback) {
  const byPredicate = new Map()
  for (const claim of claims) {
    const predicate = safeText(claim.predicate, hiddenNames, 'evidence-backed behavior')
    const values = byPredicate.get(predicate) ?? []
    values.push(safeValue(claim.value, hiddenNames))
    byPredicate.set(predicate, values)
  }
  const known = Object.keys(CLAIM_SECTION_TITLES).filter(predicate => byPredicate.has(predicate))
  const unknown = [...byPredicate.keys()].filter(predicate => !Object.hasOwn(CLAIM_SECTION_TITLES, predicate)).toSorted(compareStrings)
  const sections = [...known, ...unknown].map(predicate => {
    const title = CLAIM_SECTION_TITLES[predicate] ?? 'Інші підтверджені факти'
    const facts = [...new Set(byPredicate.get(predicate))]
      .map(value => (Object.hasOwn(CLAIM_SECTION_TITLES, predicate) ? value : `${predicate}: ${value}.`))
      .toSorted(compareStrings)
    return `## ${title}\n\n${factList(facts, fallback)}`
  })
  return sections.length > 0 ? sections.join('\n\n') : fallback
}

/* eslint-disable unicorn/no-array-callback-reference -- named claim formatter is intentionally reused for both layers */
/**
 * Collects topic-local public facts and reverse impact paths.
 * @param {{graph: Record<string, unknown>, topic: Record<string, unknown>, hiddenNames: Set<string>}} input render context
 * @returns {{implementedClaims: object[], expectedClaims: object[], outcomes: string[], contracts: string[], gaps: string[], paths: string[]}} safe topic facts
 */
function topicFacts({ graph, topic, hiddenNames }) {
  const reachable = new Set(collectReachableNodeIds(graph, topic.anchorIds))
  const claims = graph.claims.filter(claim => reachable.has(claim.subjectId))
  const publicNodes = graph.nodes.filter(node => reachable.has(node.id) && node.visibility !== 'private')
  const namesFor = kind =>
    publicNodes
      .filter(node => node.kind === kind)
      .map(node => safeText(node.name, hiddenNames, kind === 'outcome' ? 'Confirmed outcome' : 'External contract'))
      .toSorted(compareStrings)
  const localClaimIds = new Set(claims.map(claim => claim.id))
  const gaps = graph.gaps
    .filter(gap => localClaimIds.has(gap.expectedClaimId) || gap.implementedClaimIds?.some(id => localClaimIds.has(id)))
    .map(gap => `Status: ${gap.status}.`)
    .toSorted(compareStrings)
  const impact = createImpactSlice({ graph, topics: graph.topics, topicId: topic.id })
  const paths = impact.ok
    ? [...impact.slice.files, ...impact.slice.tests, ...impact.slice.configs].toSorted(compareStrings)
    : []
  return {
    implementedClaims: claims.filter(claim => claim.layer === 'implemented').toSorted((left, right) => compareStrings(left.id, right.id)),
    expectedClaims: claims.filter(claim => claim.layer === 'expected').toSorted((left, right) => compareStrings(left.id, right.id)),
    implemented: claims
      .filter(claim => claim.layer === 'implemented')
      .map(claim => `${safeText(claim.predicate, hiddenNames, 'evidence-backed behavior')}: ${safeValue(claim.value, hiddenNames)}.`)
      .toSorted(compareStrings),
    expected: claims
      .filter(claim => claim.layer === 'expected')
      .map(claim => `${safeText(claim.predicate, hiddenNames, 'evidence-backed behavior')}: ${safeValue(claim.value, hiddenNames)}.`)
      .toSorted(compareStrings),
    outcomes: namesFor('outcome'),
    contracts: namesFor('integration'),
    gaps,
    paths
  }
}
/* eslint-enable unicorn/no-array-callback-reference */

/**
 * Builds a self-contained AS-IS fragment for one discovered topic.
 * @param {{graph: Record<string, unknown>, topic: Record<string, unknown>, hiddenNames: Set<string>}} input render context
 * @returns {string} generated Markdown body
 */
function renderTopic({ graph, topic, hiddenNames }) {
  const label = PAGE_KIND_LABELS[topic.kind]
  const title = safeText(topic.title, hiddenNames, `${label} домену`)
  const facts = topicFacts({ graph, topic, hiddenNames })
  const aliases =
    Array.isArray(topic.aliases) && topic.aliases.length > 0
      ? `\n\nПопередні stable aliases: ${topic.aliases.length}.`
      : ''
  if (facts.implementedClaims.length > 0 || facts.expectedClaims.length > 0) {
    return `# ${label}: ${title}\n\n## Implemented AS-IS\n\n${claimSections(facts.implementedClaims, hiddenNames, 'Немає evidence-backed implemented behavioral claims для цього topic.')}\n\n## Outcomes і contracts\n\nOutcomes:\n${factList(facts.outcomes, 'Немає підтвердженого public outcome.')}\n\nContracts:\n${factList(facts.contracts, 'Немає підтвердженого external contract.')}\n\n## Affected paths\n\n${factList(
      facts.paths.map(path => `\`${path}\``),
      'Reverse impact paths відсутні у поточній graph projection.'
    )}\n\n## Expected behavior\n\n${claimSections(facts.expectedClaims, hiddenNames, 'Для topic немає explicit expected claim.')}\n\n## Local implementation gaps\n\n${factList(facts.gaps, 'Для topic немає actionable implementation gaps.')}${aliases}\n`
  }
  return `# ${label}: ${title}\n\n## Implemented AS-IS\n\nЦей self-contained fragment описує підтверджену поточну поведінку ${label.toLowerCase()} у domain \`${graph.domain.name}\`. Він не припускає intent поза evidence graph.\n\n## Призначення\n\n${title} надає evidence-backed boundary для зміни та перевірки поведінки domain.\n\n## Actors і trigger\n\nПотік починається з підтвердженого topic anchor і завершується зафіксованим результатом або external contract boundary.\n\n## Передумови\n\nВхід до ${label.toLowerCase()} доступний у межах owning domain, а потрібні integration boundaries представлені у traceability manifest.\n\n## Implemented facts\n\n${factList(facts.implemented, 'Для topic немає окремого implemented claim; AS-IS обмежений evidence-backed graph boundary.')}\n\n## Outcomes і contracts\n\nOutcomes:\n${factList(facts.outcomes, 'Немає окремо названого public outcome.')}\n\nContracts:\n${factList(facts.contracts, 'Немає external contract у reachable graph.')}\n\n## Affected paths\n\n${factList(
    facts.paths.map(path => `\`${path}\``),
    'Reverse impact paths відсутні у поточній graph projection.'
  )}\n\n## Alternative flows і rules\n\nAlternative та error-flow details відображаються лише тоді, коли їх представляють graph edges і claims; цей fragment не додає непідтверджених сценаріїв.\n\n## Expected behavior\n\n${factList(facts.expected, 'Для topic немає explicit expected claim. Відсутність expectation не створює implementation gap.')}\n\n## Local implementation gaps\n\n${factList(facts.gaps, 'Для topic немає actionable implementation gaps.')}${aliases}\n`
}

/**
 * Builds the optional architecture page without exposing private implementation.
 * @param {{graph: Record<string, unknown>, hiddenNames: Set<string>}} input render context
 * @returns {string} generated Markdown body
 */
function renderArchitecture({ graph, hiddenNames }) {
  const boundaries = graph.nodes
    .filter(node => node?.domainId === graph.domain.id && node.kind === 'integration' && node.visibility === 'external')
    .map(node => safeText(node.name, hiddenNames, 'External contract'))
    .toSorted(compareStrings)
  const lines =
    boundaries.length > 0
      ? boundaries.map(name => `- External boundary: ${name}`).join('\n')
      : '- Evidence-backed domain responsibility.'
  const architectureClaims = graph.claims
    .filter(claim => claim.layer === 'implemented' && ['responsibility', 'config', 'persistence', 'integration', 'state-change'].includes(claim.predicate))
    .toSorted((left, right) => compareStrings(left.id, right.id))
  if (architectureClaims.length > 0) {
    return `# Architecture: ${safeText(graph.domain.name, hiddenNames, 'Package domain')}\n\n## Implemented AS-IS\n\n${claimSections(architectureClaims, hiddenNames, 'Немає evidence-backed architecture claims.')}\n\n## Boundaries\n\n${lines}\n\n## Traceability\n\nManifest зберігає reverse evidence links до files, tests, configuration і contracts.\n`
  }
  return `# Architecture: ${safeText(graph.domain.name, hiddenNames, 'Package domain')}\n\n## Implemented AS-IS\n\nDomain architecture describes confirmed responsibilities and external boundaries without naming private implementation symbols.\n\n## Boundaries\n\n${lines}\n\n## Traceability\n\nThe manifest preserves reverse evidence links to files, tests, configuration and contracts.\n`
}

/* eslint-disable sonarjs/no-nested-template-literals -- String.raw is required for Mermaid quote escaping */
/**
 * Returns Mermaid only for a graph edge whose two visible endpoints are public.
 * @param {Record<string, unknown>} graph knowledge graph
 * @param {Set<string>} hiddenNames private names
 * @returns {string} Mermaid block or empty string
 */
function renderMermaid(graph, hiddenNames) {
  const nodes = new Map(
    graph.nodes
      .filter(node => node?.domainId === graph.domain.id && node.visibility !== 'private')
      .map(node => [node.id, node])
  )
  const edge = graph.edges.find(item => nodes.has(item?.fromId) && nodes.has(item?.toId))
  if (!edge) return ''
  const from = safeText(nodes.get(edge.fromId).name, hiddenNames, 'Source')
  const to = safeText(nodes.get(edge.toId).name, hiddenNames, 'Outcome')
  return `\n\n\`\`\`mermaid\nflowchart LR\n  source["${from.replaceAll('"', String.raw`\"`)}"] --> target["${to.replaceAll('"', String.raw`\"`)}"]\n\`\`\``
}
/* eslint-enable sonarjs/no-nested-template-literals */

/**
 * Builds the required package navigation page.
 * @param {{graph: Record<string, unknown>, topics: Array<Record<string, unknown>>, architecture: boolean, hiddenNames: Set<string>}} input render context
 * @returns {string} generated Markdown body
 */
function renderIndex({ graph, topics, architecture, hiddenNames }) {
  const groups = topicsByKind(topics)
  const sections = []
  if (architecture) sections.push('- [Architecture](explanation/architecture.md)')
  for (const kind of ['capability', 'process', 'contract']) {
    for (const topic of groups.get(kind) ?? []) {
      const path = `${PAGE_KIND_PATHS[kind].replace('docs/', '')}/${topicToken(topic.id)}.md`
      sections.push(`- [${safeText(topic.title, hiddenNames, PAGE_KIND_LABELS[kind])}](${path})`)
    }
  }
  const navigation =
    sections.length > 0 ? sections.join('\n') : '- Наразі graph не має evidence-backed dedicated topics.'
  return `# Package knowledge: ${safeText(graph.domain.name, hiddenNames, 'Package domain')}\n\n## Implemented AS-IS\n\nЦя навігація є deterministic projection одного documentation domain. Вона веде лише до meaningful pages і не розкриває private implementation symbols.\n\n## Views\n\n${navigation}\n\n## Traceability\n\n\`docs/.docgen/manifest.json\` містить stable topic identities, claims, evidence та reverse impact data.\n`
}

/**
 * Renders actionable (not satisfied) gap rows only.
 * @param {Record<string, unknown>} graph knowledge graph
 * @returns {string} generated Markdown body
 */
function renderGaps(graph) {
  const gaps = graph.gaps
    .filter(gap => gap.status !== 'satisfied')
    .toSorted((left, right) => compareStrings(left.id, right.id))
  const rows = gaps.map(gap => `- Status: ${gap.status}; explicit expectation requires review.`).join('\n')
  return `# Implementation gaps\n\n## Explicit expectation comparison\n\n${rows}\n\nOnly explicit expected claims participate in this view; absent expectations are not defects.\n`
}

/**
 * Renders candidate Markdown pages and a schema-compatible manifest.
 * @param {{graph: Record<string, unknown>, existingFiles?: Record<string, string>}} input graph plus committed page bytes
 * @returns {{ok: true, files: Record<string, string>} | {ok: false, diagnostics: Array<Record<string, unknown>>}} candidate map or blocking diagnostics
 */
export function renderKnowledgeArtifacts({ graph, existingFiles = {} }) {
  if (
    !graph ||
    typeof graph !== 'object' ||
    !graph.domain ||
    typeof graph.domain.id !== 'string' ||
    graph.domain.id === ''
  ) {
    return { ok: false, diagnostics: [diagnostic('invalid-render-graph', 'Graph має містити owning domain ID.')] }
  }
  if (!existingFiles || typeof existingFiles !== 'object' || Array.isArray(existingFiles)) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-existing-files', 'existingFiles має бути path → Markdown map.')]
    }
  }
  const manifest = canonicalGraph(graph)
  const hiddenNames = privateNames(manifest)
  const topics = pageTopics(manifest)
  const architecture = needsArchitecture(manifest)
  const pages = [
    {
      path: 'docs/index.md',
      zoneId: 'package-index',
      content: renderIndex({ graph: manifest, topics, architecture, hiddenNames })
    }
  ]
  if (architecture) {
    pages.push({
      path: 'docs/explanation/architecture.md',
      zoneId: 'package-architecture',
      content: `${renderArchitecture({ graph: manifest, hiddenNames })}${renderMermaid(manifest, hiddenNames)}\n`
    })
  }
  for (const topic of topics) {
    const token = topicToken(topic.id)
    pages.push({
      path: `${PAGE_KIND_PATHS[topic.kind]}/${token}.md`,
      zoneId: `${topic.kind}-${token}`,
      content: renderTopic({ graph: manifest, topic, hiddenNames })
    })
  }
  if (manifest.gaps.some(gap => gap.status !== 'satisfied')) {
    pages.push({ path: 'docs/implementation-gaps.md', zoneId: 'implementation-gaps', content: renderGaps(manifest) })
  }

  const files = { [MANIFEST_PATH]: serializeKnowledgeGraph(manifest) }
  const diagnostics = []
  for (const page of pages) {
    const rendered = renderPage({ ...page, existing: existingFiles[page.path] })
    if (rendered.ok) {
      files[page.path] = rendered.markdown
    } else {
      diagnostics.push(...rendered.diagnostics)
    }
  }
  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: diagnostics.toSorted((left, right) => compareStrings(left.path ?? '', right.path ?? ''))
    }
  }
  const humanMarkdown = Object.entries(files)
    .filter(([path]) => path.endsWith('.md'))
    .map(([, content]) => content)
    .join('\n')
  const leaked = [...hiddenNames].filter(name => humanMarkdown.includes(name))
  if (leaked.length > 0) {
    return {
      ok: false,
      diagnostics: leaked
        .toSorted(compareStrings)
        .map(name => diagnostic('private-symbol-leak', `Human Markdown містить private symbol name "${name}".`))
    }
  }
  return { ok: true, files }
}
