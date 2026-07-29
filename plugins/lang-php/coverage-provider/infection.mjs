/**
 * Парсинг JSON-звіту `infection/infection` (`--logger-json`) у контракт
 * CoverageRow: caught/total і survived-групи по файлах. Форма звірена за
 * офіційною JSON-схемою логера (infection/infection, `resources/schema.json`
 * — секції `stats`/`escaped`/`killed`/`timeouted`/`errored`/`notCovered`),
 * без live-прогону (test-only середовище без php-тулчейну).
 *
 * Семантика caught/total дзеркалить rust-парсер (`mutants.mjs`): timeout
 * рахується як caught (мутант зупинив suite). `errored`/`ignored` виключені
 * зі знаменника — аналог `Unviable` у cargo-mutants (не валідний вимір, а не
 * пережитий мутант). `notCovered` (мутація на рядку без жодного тесту) —
 * валідний, але не спійманий мутант, тож іде у survived поруч з `escaped`.
 */

/**
 * Мапить один запис `escaped`/`notCovered` infection у survived-мутант
 * CoverageRow.
 * @param {{location?: {start?: {line?: number, column?: number}}, mutatorName?: string, originalSourceCode?: string, mutatedSourceCode?: string}} m один запис масиву `escaped`/`notCovered`
 * @returns {{line: number, col: number, mutantType: string, original: string, replacement: string}} survived-мутант
 */
function toSurvivedMutant(m) {
  return {
    line: m?.location?.start?.line ?? 0,
    col: m?.location?.start?.column ?? 0,
    mutantType: m?.mutatorName ?? 'Unknown',
    original: (m?.originalSourceCode ?? '').trim().slice(0, 200),
    replacement: (m?.mutatedSourceCode ?? '').trim().slice(0, 200)
  }
}

/**
 * Рахує caught/total і збирає survived-мутанти зі звіту infection.
 * @param {{stats?: {killedCount?: number, timedOutCount?: number, escapedCount?: number, notCoveredByTestsCount?: number}, escaped?: object[], notCovered?: object[]}} report розпарсений JSON-звіт infection
 * @returns {{caught: number, total: number, survived: Array<{file: string, mutants: object[], exampleTest: null, recommendationText: null}>}} результат у shape CoverageRow
 */
export function parseInfectionReport(report) {
  const stats = report?.stats ?? {}
  const killed = stats.killedCount ?? 0
  const timedOut = stats.timedOutCount ?? 0
  const escapedCount = stats.escapedCount ?? 0
  const notCoveredCount = stats.notCoveredByTestsCount ?? 0

  const caught = killed + timedOut
  const total = killed + timedOut + escapedCount + notCoveredCount

  /** @type {Map<string, object[]>} */
  const byFile = new Map()
  for (const m of [...(report?.escaped ?? []), ...(report?.notCovered ?? [])]) {
    const file = m?.originalFilePath ?? 'unknown'
    if (!byFile.has(file)) byFile.set(file, [])
    byFile.get(file).push(toSurvivedMutant(m))
  }

  const survived = []
  for (const [file, mutants] of byFile) {
    survived.push({ file, mutants, exampleTest: null, recommendationText: null })
  }
  return { caught, total, survived }
}
