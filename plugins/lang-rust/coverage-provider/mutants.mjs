/**
 * Парсинг `mutants.out/outcomes.json` (`cargo mutants`) у контракт CoverageRow:
 * caught/total і survived-групи по файлах. Форму звірено на живому прогоні
 * cargo-mutants 27.0: `outcomes[].scenario` — `"Baseline"` або `{Mutant: {...}}`,
 * `summary` — `CaughtMutant`/`MissedMutant`/`Timeout`/`Unviable`/`Success`.
 * Unviable (не компілюється) виключається зі знаменника score, Timeout
 * рахується як caught (мутант зупинив suite) — та сама семантика, що й у
 * Stryker-парсера lang-js.
 */

/**
 * Рахує caught/total і збирає survived-мутанти зі звіту cargo-mutants.
 * @param {{outcomes?: Array<{scenario: string|{Mutant: object}, summary: string}>}} report розпарсений outcomes.json
 * @returns {{caught: number, total: number, survived: Array<{file: string, mutants: Array<{line: number, col: number, mutantType: string, original: string, replacement: string}>, exampleTest: null, recommendationText: null}>}} результат у shape CoverageRow
 */
export function parseMutantsOutcomes(report) {
  let caught = 0
  let total = 0
  /** @type {Map<string, Array<object>>} */
  const byFile = new Map()

  for (const outcome of report.outcomes ?? []) {
    const mutant = outcome?.scenario?.Mutant
    if (!mutant) continue
    if (outcome.summary === 'CaughtMutant' || outcome.summary === 'Timeout') {
      caught += 1
      total += 1
      continue
    }
    if (outcome.summary !== 'MissedMutant') continue
    total += 1
    const file = mutant.file ?? 'unknown'
    if (!byFile.has(file)) byFile.set(file, [])
    byFile.get(file).push({
      line: mutant.span?.start?.line ?? 0,
      col: mutant.span?.start?.column ?? 0,
      mutantType: mutant.genre ?? 'Unknown',
      original: mutant.function?.function_name ?? mutant.name ?? '',
      replacement: mutant.replacement ?? ''
    })
  }

  const survived = []
  for (const [file, mutants] of byFile) {
    survived.push({ file, mutants, exampleTest: null, recommendationText: null })
  }
  return { caught, total, survived }
}
