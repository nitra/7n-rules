/** Збирає parser-provided call facts у deterministic normalized graph edges. */

/**
 * Додає invoke або integrate edge для parser-derived call facts кожного semantic unit.
 * @param {{units: Array<{localId: string}>, localUnits: Map<string, string>, importedBindings: Map<string, string>, callsForUnit: (unit: object, visit: (call: {root: string, evidence: object[]}) => void) => void}} input parser-specific call traversal
 * @returns {Array<Record<string, unknown>>} stable normalized edges
 */
export function collectCallEdges({ units, localUnits, importedBindings, callsForUnit }) {
  const edges = []
  for (const unit of units) {
    callsForUnit(unit, ({ root, evidence }) => {
      const target = localUnits.get(root)
      if (target && target !== unit.localId) {
        edges.push({ kind: 'invokes', fromLocalId: unit.localId, to: { localId: target }, evidence })
        return
      }
      const specifier = importedBindings.get(root)
      if (specifier) {
        edges.push({
          kind: 'integrates',
          fromLocalId: unit.localId,
          to: { unresolvedSpecifier: specifier, opaque: true },
          evidence
        })
      }
    })
  }
  return edges.toSorted((left, right) =>
    JSON.stringify([left.fromLocalId, left.kind, left.to, left.evidence[0].span]).localeCompare(
      JSON.stringify([right.fromLocalId, right.kind, right.to, right.evidence[0].span])
    )
  )
}
