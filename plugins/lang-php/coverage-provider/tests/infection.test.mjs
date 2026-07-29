import { describe, expect, test } from 'vitest'

import { parseInfectionReport } from '../infection.mjs'

// Форма звірена за офіційною JSON-схемою логера infection/infection
// (resources/schema.json): `stats` + масиви `escaped`/`killed`/`timeouted`/
// `errored`/`notCovered`, кожен запис — `mutatorName`/`originalFilePath`/
// `location.start.{line,column}`/`originalSourceCode`/`mutatedSourceCode`.
const INFECTION_FIXTURE = {
  stats: {
    totalMutantsCount: 10,
    killedCount: 6,
    timedOutCount: 1,
    escapedCount: 2,
    notCoveredByTestsCount: 1,
    errorCount: 0,
    ignoredCount: 0,
    msi: 70
  },
  escaped: [
    {
      mutatorName: 'Plus',
      originalSourceCode: '$a + $b',
      mutatedSourceCode: '$a - $b',
      originalFilePath: 'src/Foo.php',
      location: { start: { line: 12, column: 9 }, end: { line: 12, column: 16 } }
    }
  ],
  notCovered: [
    {
      mutatorName: 'IncrementInteger',
      originalSourceCode: '$i++',
      mutatedSourceCode: '$i--',
      originalFilePath: 'src/Bar.php',
      location: { start: { line: 3, column: 5 } }
    }
  ]
}

describe('parseInfectionReport', () => {
  test('caught = killed + timedOut, total включає escaped/notCovered, виключає errored/ignored', () => {
    const r = parseInfectionReport(INFECTION_FIXTURE)
    expect(r.caught).toBe(7)
    expect(r.total).toBe(10)
  })

  test('survived групує escaped + notCovered по файлах', () => {
    const r = parseInfectionReport(INFECTION_FIXTURE)
    expect(r.survived).toHaveLength(2)
    const foo = r.survived.find(g => g.file === 'src/Foo.php')
    expect(foo.mutants).toEqual([{ line: 12, col: 9, mutantType: 'Plus', original: '$a + $b', replacement: '$a - $b' }])
    const bar = r.survived.find(g => g.file === 'src/Bar.php')
    expect(bar.mutants).toEqual([
      { line: 3, col: 5, mutantType: 'IncrementInteger', original: '$i++', replacement: '$i--' }
    ])
    expect(foo.exampleTest).toBeNull()
    expect(foo.recommendationText).toBeNull()
  })

  test('порожній звіт → нулі й порожній survived', () => {
    expect(parseInfectionReport({})).toEqual({ caught: 0, total: 0, survived: [] })
  })

  test('декілька escaped-мутантів в одному файлі групуються в один запис', () => {
    const report = {
      stats: { killedCount: 0, timedOutCount: 0, escapedCount: 2, notCoveredByTestsCount: 0 },
      escaped: [
        { mutatorName: 'A', originalFilePath: 'src/X.php', location: { start: { line: 1 } } },
        { mutatorName: 'B', originalFilePath: 'src/X.php', location: { start: { line: 2 } } }
      ]
    }
    const r = parseInfectionReport(report)
    expect(r.survived).toHaveLength(1)
    expect(r.survived[0].mutants).toHaveLength(2)
  })
})
