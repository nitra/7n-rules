/**
 * Застосовує verdicts до coverage rows: фільтрує survived мутантів,
 * декрементує mutation.total на кількість allowed-gaps, повертає окремий
 * список allowedGaps для рендеру в COVERAGE.md.
 *
 * Skip rule: verdict ∈ {equivalent,defensive,glue,wrapper} AND confidence ≥ threshold.
 * Решта (включно з worth-testing і low-confidence skip-verdicts) залишаються в survived.
 */

const SKIP_VERDICTS = new Set(['equivalent', 'defensive', 'glue', 'wrapper'])

/**
 * Чи verdict кваліфікує мутанта як allowed-gap (виключити з Killable).
 * @param {{verdict: string, confidence: number}} verdict verdict-об'єкт
 * @param {number} threshold confidence threshold (наприклад 0.7)
 * @returns {boolean} true якщо мутант — allowed gap
 */
export function isAllowedGap(verdict, threshold) {
  return SKIP_VERDICTS.has(verdict.verdict) && verdict.confidence >= threshold
}

/**
 * Застосовує verdicts до coverage rows. Фільтрує `survived` за isAllowedGap,
 * зменшує `mutation.total` на скільки мутантів стало allowed-gap.
 * Не мутує вхідні дані.
 * @param {Array<{area: string, coverage: object, mutation: {caught: number, total: number}, survived?: Array<{file: string, mutants: Array<object>, exampleTest?: object|null, recommendationText?: string|null}>}>} rows вхідні рядки
 * @param {Array<{key: string, verdict: {verdict: string, confidence: number, reason: string}}>} verdicts класифіковані verdict-и
 * @param {number} threshold confidence threshold для allowed-gap
 * @returns {{rows: Array<object>, allowedGaps: Array<{file: string, mutant: object, verdict: object}>}} augmented rows + список allowed-gaps
 */
export function applyVerdicts(rows, verdicts, threshold) {
  const verdictByKey = new Map()
  for (const { key, verdict } of verdicts) verdictByKey.set(key, verdict)

  const allowedGaps = []

  const augmentedRows = rows.map(row => {
    const survived = row.survived ?? []
    let skippedCount = 0
    const remainingSurvived = []

    for (const group of survived) {
      const remainingMutants = []
      for (const mutant of group.mutants) {
        const key = `${group.file}:${mutant.line}:${mutant.col}:${mutant.replacement}`
        const verdict = verdictByKey.get(key)
        if (verdict && isAllowedGap(verdict, threshold)) {
          allowedGaps.push({ file: group.file, mutant, verdict })
          skippedCount += 1
        } else {
          remainingMutants.push(mutant)
        }
      }
      if (remainingMutants.length > 0) {
        remainingSurvived.push({ ...group, mutants: remainingMutants })
      }
    }

    return {
      ...row,
      survived: remainingSurvived,
      mutation: { ...row.mutation, total: row.mutation.total - skippedCount }
    }
  })

  return { rows: augmentedRows, allowedGaps }
}
