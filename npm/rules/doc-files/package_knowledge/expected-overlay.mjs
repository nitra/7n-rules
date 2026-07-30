/**
 * Додає лише явно задані expected claims до evidence-backed knowledge graph.
 *
 * Модуль не інтерпретує prose і не зіставляє claims: він зберігає protected
 * expectation як окремий шар, щоб gap engine міг порівнювати його з AS-IS.
 */

/**
 * Рекурсивно впорядковує attributes для byte-stable graph collections.
 * @param {unknown} value довільне JSON-подібне значення
 * @returns {unknown} canonicalized copy
 */
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(item => canonicalize(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)])
  )
}

/**
 * Створює blocking diagnostic у стабільній формі overlay pipeline.
 * @param {string} code machine-readable code
 * @param {string} message user-facing detail
 * @param {string | null} [claimId] expectation claim identity
 * @returns {{ code: string, message: string, claimId: string | null }} stable diagnostic
 */
function diagnostic(code, message, claimId = null) {
  return { code, message, claimId }
}

/**
 * Перевіряє форму явно заданого expected claim до додавання у graph.
 * @param {unknown} claim expectation input
 * @returns {string | null} failure code or null
 */
function claimFailure(claim) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) return 'invalid-expected-claim'
  if (
    typeof claim.id !== 'string' ||
    claim.id === '' ||
    typeof claim.subjectId !== 'string' ||
    claim.subjectId === '' ||
    typeof claim.predicate !== 'string' ||
    claim.predicate === '' ||
    typeof claim.sourceFingerprint !== 'string' ||
    claim.sourceFingerprint === ''
  ) {
    return 'invalid-expected-claim'
  }
  if (!Array.isArray(claim.evidenceIds) || claim.evidenceIds.length === 0) return 'expected-without-evidence'
  if (
    new Set(claim.evidenceIds).size !== claim.evidenceIds.length ||
    claim.evidenceIds.some(id => typeof id !== 'string' || id === '')
  ) {
    return 'invalid-expected-evidence'
  }
  if (typeof claim.confidence !== 'number' || claim.confidence < 0 || claim.confidence > 1) {
    return 'invalid-expected-confidence'
  }
  return null
}

/* eslint-disable sonarjs/cognitive-complexity -- one fail-closed pass preserves cross-collection overlay invariants */
/**
 * Adds explicit expected claims and evidence without mutating the input graph.
 *
 * Existing graph evidence can be referenced directly; new evidence is optional
 * and must have unique IDs. Every expectation stays evidence-backed and points
 * at a node in the current domain, otherwise publication is blocked.
 * @param {Record<string, unknown>} graph base normalized graph
 * @param {{ claims?: unknown[], evidence?: unknown[] }} [overlay] protected expected overlay
 * @returns {{ ok: true, graph: Record<string, unknown> } | { ok: false, diagnostics: Array<Record<string, unknown>> }} merged graph or blockers
 */
export function applyExpectedOverlay(graph, overlay = {}) {
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    return { ok: false, diagnostics: [diagnostic('invalid-graph', 'Graph має бути обʼєктом.')] }
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.claims) || !Array.isArray(graph.evidence)) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-graph', 'Graph має містити nodes[], claims[] та evidence[].')]
    }
  }
  const claims = overlay.claims ?? []
  const evidence = overlay.evidence ?? []
  if (!Array.isArray(claims) || !Array.isArray(evidence)) {
    return {
      ok: false,
      diagnostics: [diagnostic('invalid-expected-overlay', 'Overlay має містити масиви claims[] та evidence[].')]
    }
  }

  const nodeIds = new Set(graph.nodes.map(node => node?.id).filter(id => typeof id === 'string'))
  const graphClaimIds = new Set(graph.claims.map(claim => claim?.id).filter(id => typeof id === 'string'))
  const evidenceIds = new Set(graph.evidence.map(item => item?.id).filter(id => typeof id === 'string'))
  const diagnostics = []
  const newEvidenceIds = new Set()

  for (const item of evidence) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || item.id === '') {
      diagnostics.push(diagnostic('invalid-expected-evidence', 'Overlay evidence мусить мати непорожній id.'))
      continue
    }
    if (evidenceIds.has(item.id) || newEvidenceIds.has(item.id)) {
      diagnostics.push(diagnostic('duplicate-evidence-id', `Evidence ID "${item.id}" вже існує.`))
      continue
    }
    newEvidenceIds.add(item.id)
  }
  const availableEvidenceIds = evidenceIds.union(newEvidenceIds)
  const newClaimIds = new Set()

  for (const rawClaim of claims) {
    const claimId = rawClaim && typeof rawClaim === 'object' ? rawClaim.id : null
    const failure = claimFailure(rawClaim)
    if (failure) {
      diagnostics.push(
        diagnostic(
          failure,
          'Expected claim не має повного evidence-backed contract.',
          typeof claimId === 'string' ? claimId : null
        )
      )
      continue
    }
    if (rawClaim.layer !== undefined && rawClaim.layer !== 'expected') {
      diagnostics.push(diagnostic('invalid-expected-layer', 'Overlay приймає лише claims layer=expected.', rawClaim.id))
      continue
    }
    if (graphClaimIds.has(rawClaim.id) || newClaimIds.has(rawClaim.id)) {
      diagnostics.push(diagnostic('duplicate-claim-id', `Claim ID "${rawClaim.id}" вже існує.`, rawClaim.id))
      continue
    }
    if (!nodeIds.has(rawClaim.subjectId)) {
      diagnostics.push(
        diagnostic('unknown-expected-subject', `Subject "${rawClaim.subjectId}" відсутній у graph.`, rawClaim.id)
      )
      continue
    }
    if (rawClaim.evidenceIds.some(id => !availableEvidenceIds.has(id))) {
      diagnostics.push(
        diagnostic('unknown-expected-evidence', 'Expected claim посилається на відсутнє evidence.', rawClaim.id)
      )
      continue
    }
    newClaimIds.add(rawClaim.id)
  }

  if (diagnostics.length > 0) {
    return {
      ok: false,
      diagnostics: diagnostics.toSorted((left, right) =>
        `${left.claimId ?? ''}:${left.code}:${left.message}`.localeCompare(
          `${right.claimId ?? ''}:${right.code}:${right.message}`
        )
      )
    }
  }

  const expectedClaims = claims.map(rawClaim =>
    canonicalize({
      id: rawClaim.id,
      subjectId: rawClaim.subjectId,
      layer: 'expected',
      predicate: rawClaim.predicate,
      value: rawClaim.value,
      evidenceIds: [...rawClaim.evidenceIds].toSorted(),
      confidence: rawClaim.confidence,
      sourceFingerprint: rawClaim.sourceFingerprint
    })
  )
  return {
    ok: true,
    graph: {
      ...canonicalize(graph),
      claims: [...graph.claims.map(claim => canonicalize(claim)), ...expectedClaims].toSorted((left, right) =>
        left.id.localeCompare(right.id)
      ),
      evidence: [
        ...graph.evidence.map(item => canonicalize(item)),
        ...evidence.map(item => canonicalize(item))
      ].toSorted((left, right) => left.id.localeCompare(right.id))
    }
  }
}
/* eslint-enable sonarjs/cognitive-complexity */
