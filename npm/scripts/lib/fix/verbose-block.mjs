/**
 * Verbose-блок після кожного LLM-рунга у `--full` режимі.
 * Друкує стислий опис промпту і thinking-монолог моделі (якщо є).
 * Вимикається через `N_CURSOR_FIX_VERBOSE=off`.
 */

const THINKING_PREVIEW_LEN = 500

/**
 * Форматує рядок файлів для prompt-блоку.
 * @param {number} count кількість файлів
 * @param {number} totalBytes сумарний розмір у байтах
 * @returns {string}
 */
function formatFiles(count, totalBytes) {
  if (count === 0) return '(none)'
  const kb = (totalBytes / 1024).toFixed(1)
  const word = count === 1 ? 'файл' : count < 5 ? 'файли' : 'файлів'
  return `${count} ${word} (${kb} KB)`
}

/**
 * Форматує рядок feedback для prompt-блоку.
 * @param {boolean} hasFeedback чи є feedback
 * @param {string|null} feedbackModel модель попереднього рунга
 * @param {number} feedbackChangesCount кількість змін попереднього рунга
 * @param {string|null} feedbackError помилка попереднього рунга
 * @returns {string}
 */
function formatFeedback(hasFeedback, feedbackModel, feedbackChangesCount, feedbackError) {
  if (!hasFeedback) return '(none)'
  const parts = []
  if (feedbackModel) parts.push(`model=${feedbackModel}`)
  parts.push(`${feedbackChangesCount} changes`)
  if (feedbackError) parts.push(`error="${feedbackError.slice(0, 60)}"`)
  return parts.join(', ')
}

/**
 * Друкує verbose-блок після рядка рунга (`⚡`/`✅`).
 * Містить стислий опис промпту і thinking-монолог моделі (якщо є).
 * Не викликається якщо `N_CURSOR_FIX_VERBOSE=off`.
 * @param {string} ruleId ID правила
 * @param {{ ruleMdcLen: number, violationLen: number, filesCount: number, filesTotalBytes: number, hasFeedback: boolean, feedbackModel: string|null, feedbackChangesCount: number, feedbackError: string|null }} promptSummary стислий опис промпту
 * @param {string|null} reasoning thinking-монолог моделі
 * @param {string|null} reasoningSource джерело reasoning ('field'|'think_tag'|'truncated'|null)
 */
export function printVerboseBlock(ruleId, promptSummary, reasoning, reasoningSource) {
  const {
    ruleMdcLen,
    violationLen,
    filesCount,
    filesTotalBytes,
    hasFeedback,
    feedbackModel,
    feedbackChangesCount,
    feedbackError
  } = promptSummary

  console.log(``)
  console.log(`  prompt:`)
  console.log(`    rule:      n-${ruleId}.mdc (${ruleMdcLen} chars)`)
  console.log(`    violation: ${violationLen} chars`)
  console.log(`    files:     ${formatFiles(filesCount, filesTotalBytes)}`)
  console.log(`    feedback:  ${formatFeedback(hasFeedback, feedbackModel, feedbackChangesCount, feedbackError)}`)

  if (reasoning) {
    const preview =
      reasoning.length > THINKING_PREVIEW_LEN
        ? reasoning.slice(0, THINKING_PREVIEW_LEN) + ` … (+${reasoning.length - THINKING_PREVIEW_LEN} chars)`
        : reasoning
    console.log(``)
    console.log(`  thinking [${reasoningSource}, ${reasoning.length} chars]:`)
    for (const line of preview.split('\n')) {
      console.log(`    ${line}`)
    }
  } else {
    console.log(``)
    console.log(`  thinking: (none)`)
  }
  console.log(``)
}
