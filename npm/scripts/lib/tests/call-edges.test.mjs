import { describe, expect, test } from 'vitest'

import { collectCallEdges } from '../plugin-api/call-edges.mjs'

const evidence = line => [{ file: 'src/service.mjs', span: { startLine: line, endLine: line } }]

describe('collectCallEdges', () => {
  test('нормалізує local та imported calls, відкидаючи self і unknown targets', () => {
    const calls = new Map([
      [
        'service',
        [
          { root: 'gateway', evidence: evidence(8) },
          { root: 'helper', evidence: evidence(4) },
          { root: 'service', evidence: evidence(3) },
          { root: 'unknown', evidence: evidence(2) }
        ]
      ],
      ['helper', []]
    ])

    const edges = collectCallEdges({
      units: [{ localId: 'service' }, { localId: 'helper' }],
      localUnits: new Map([
        ['service', 'service'],
        ['helper', 'helper']
      ]),
      importedBindings: new Map([['gateway', '@example/gateway']]),
      callsForUnit: (unit, visit) => {
        for (const call of calls.get(unit.localId)) visit(call)
      }
    })

    expect(edges).toEqual([
      {
        kind: 'integrates',
        fromLocalId: 'service',
        to: { unresolvedSpecifier: '@example/gateway', opaque: true },
        evidence: evidence(8)
      },
      {
        kind: 'invokes',
        fromLocalId: 'service',
        to: { localId: 'helper' },
        evidence: evidence(4)
      }
    ])
  })
})
