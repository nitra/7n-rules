/**
 * Порівнює evidence-backed expected та implemented claims без LLM.
 *
 * Engine приймає лише explicit structured mappings: він не виводить semantic
 * відповідність із prose, а низьку confidence чи суперечливі mappings чесно
 * залишає у статусі unresolved.
 */

const RELATIONS = new Set(['equivalent', 'contradicts'])

/**
 * Створює blocking validation diagnostic, що не перетворюється на gap.
 * @param {string} code stable code
 * @param {string} message explanation
 * @returns {{ code: string, message: string }} diagnostic
 */
function diagnostic(code, message) {
  return { code, message }
}

/**
 * Нормалізує parser/coverage validation state у blocking diagnostics.
 * @param {unknown} validation optional publication gate state
 * @returns {Array<{ code: string, message: string }>} stable blockers
 */
function validationBlockers(validation) {
  if (!validation || typeof validation !== 'object') return []
  const blockers = []
  for (const [gate, code] of [
    ['parser', 'parser-blocked'],
    ['coverage', 'coverage-blocked']
  ]) {
    const state = validation[gate]
    if (state?.ok === false) {
      blockers.push(diagnostic(code, typeof state.message === 'string' ? state.message : `${gate} gate не пройдено.`))
    }
  }
  return blockers.toSorted((left, right) => left.code.localeCompare(right.code))
}

/**
 * Повертає true лише для повністю підтвердженого claim.
 * @param {Record<string, unknown>} claim knowledge claim
 * @param {Set<string>} evidenceIds known evidence IDs
 * @param {number} minimumConfidence policy threshold
 * @returns {boolean} whether the claim can determine a hard status
 */
function hasStrongEvidence(claim, evidenceIds, minimumConfidence) {
  return (
    Array.isArray(claim.evidenceIds) &&
    claim.evidenceIds.length > 0 &&
    claim.evidenceIds.every(id => evidenceIds.has(id)) &&
    typeof claim.confidence === 'number' &&
    claim.confidence >= minimumConfidence
  )
}

/**
 * Validates a caller-provided exact claim mapping.
 * @param {unknown} mapping mapping candidate
 * @param {Map<string, Record<string, unknown>>} expectedById explicit expected claims
 * @param {Map<string, Record<string, unknown>>} implementedById AS-IS claims
 * @param {Set<string>} evidenceIds known graph evidence
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, diagnostic: { code: string, message: string } }} checked mapping
 */
function validateMapping(mapping, expectedById, implementedById, evidenceIds) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    return { ok: false, diagnostic: diagnostic('invalid-gap-mapping', 'Gap mapping має бути обʼєктом.') }
  }
  if (
    typeof mapping.expectedClaimId !== 'string' ||
    typeof mapping.implementedClaimId !== 'string' ||
    !RELATIONS.has(mapping.relation) ||
    !Array.isArray(mapping.evidenceIds) ||
    mapping.evidenceIds.length === 0
  ) {
    return {
      ok: false,
      diagnostic: diagnostic('invalid-gap-mapping', 'Mapping має exact expected/implemented IDs, relation і evidenceIds[].')
    }
  }
  if (!expectedById.has(mapping.expectedClaimId) || !implementedById.has(mapping.implementedClaimId)) {
    return {
      ok: false,
      diagnostic: diagnostic('unknown-gap-claim', 'Mapping посилається на відсутній expected або implemented claim.')
    }
  }
  if (new Set(mapping.evidenceIds).size !== mapping.evidenceIds.length || mapping.evidenceIds.some(id => !evidenceIds.has(id))) {
    return { ok: false, diagnostic: diagnostic('invalid-gap-evidence', 'Mapping не має валідного evidence provenance.') }
  }
  return { ok: true, value: mapping }
}

/**
 * Evaluates deterministic gap statuses from explicit structured mappings.
 * @param {{ graph: Record<string, unknown>, mappings?: unknown[], validation?: { parser?: { ok?: boolean, message?: string }, coverage?: { ok?: boolean, message?: string } }, minimumConfidence?: number }} input graph and exact comparison facts
 * @returns {{ ok: true, gaps: Array<Record<string, unknown>> } | { ok: false, diagnostics: Array<{ code: string, message: string }> }} sorted gaps or publication blockers
 */
export function evaluateGaps({ graph, mappings = [], validation = {}, minimumConfidence = 1 }) {
  const blockers = validationBlockers(validation)
  if (blockers.length > 0) return { ok: false, diagnostics: blockers }
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.claims) || !Array.isArray(graph.evidence)) {
    return { ok: false, diagnostics: [diagnostic('invalid-gap-graph', 'Graph має містити claims[] та evidence[].')] }
  }
  if (!Array.isArray(mappings) || typeof minimumConfidence !== 'number' || minimumConfidence < 0 || minimumConfidence > 1) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-gap-input', 'mappings має бути масивом, minimumConfidence — числом від 0 до 1.')]
    }
  }

  const expectedClaims = graph.claims.filter(claim => claim?.layer === 'expected').toSorted((left, right) => left.id.localeCompare(right.id))
  if (expectedClaims.length === 0) return { ok: true, gaps: [] }

  const expectedById = new Map(expectedClaims.map(claim => [claim.id, claim]))
  const implementedById = new Map(
    graph.claims.filter(claim => claim?.layer === 'implemented').map(claim => [claim.id, claim])
  )
  const evidenceIds = new Set(graph.evidence.map(item => item?.id).filter(id => typeof id === 'string'))
  const checkedMappings = mappings.map(mapping => validateMapping(mapping, expectedById, implementedById, evidenceIds))
  const mappingDiagnostics = checkedMappings.filter(result => !result.ok).map(result => result.diagnostic)
  if (mappingDiagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: mappingDiagnostics.toSorted((left, right) => `${left.code}:${left.message}`.localeCompare(`${right.code}:${right.message}`))
    }
  }

  const mappingsByExpected = new Map()
  for (const mapping of checkedMappings.map(result => result.value)) {
    const items = mappingsByExpected.get(mapping.expectedClaimId) ?? []
    items.push(mapping)
    mappingsByExpected.set(mapping.expectedClaimId, items)
  }

  const gaps = expectedClaims.map(expectedClaim => {
    const claimMappings = (mappingsByExpected.get(expectedClaim.id) ?? []).toSorted((left, right) =>
      `${left.implementedClaimId}:${left.relation}`.localeCompare(`${right.implementedClaimId}:${right.relation}`)
    )
    const implementationClaims = claimMappings.map(mapping => implementedById.get(mapping.implementedClaimId))
    const strongExpected = hasStrongEvidence(expectedClaim, evidenceIds, minimumConfidence)
    const strongMappings = claimMappings.every(mapping => mapping.evidenceIds.length > 0)
    const strongImplemented = implementationClaims.every(claim => hasStrongEvidence(claim, evidenceIds, minimumConfidence))
    const relations = new Set(claimMappings.map(mapping => mapping.relation))
    let status
    if (!strongExpected || !strongMappings || !strongImplemented || relations.size > 1) {
      status = 'unresolved'
    } else if (claimMappings.length === 0) {
      status = 'missing'
    } else if (relations.has('equivalent')) {
      status = 'satisfied'
    } else {
      status = 'diverged'
    }
    const gapEvidenceIds = new Set(expectedClaim.evidenceIds)
    for (const mapping of claimMappings) {
      for (const evidenceId of mapping.evidenceIds) gapEvidenceIds.add(evidenceId)
    }
    for (const claim of implementationClaims) {
      for (const evidenceId of claim.evidenceIds) gapEvidenceIds.add(evidenceId)
    }
    return {
      id: `gap:${expectedClaim.id}`,
      status,
      expectedClaimId: expectedClaim.id,
      implementedClaimIds: [...new Set(claimMappings.map(mapping => mapping.implementedClaimId))].toSorted(),
      evidenceIds: [...gapEvidenceIds].toSorted()
    }
  })
  return { ok: true, gaps: gaps.toSorted((left, right) => left.id.localeCompare(right.id)) }
}
