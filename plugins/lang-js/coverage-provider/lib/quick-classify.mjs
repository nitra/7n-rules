/**
 * Швидка локальна евристика «чи потрібні файлу unit-тести» — без I/O і без LLM.
 * Витягнуто з `assess-need.mjs` `@7n/test` (spec 2026-07-22 absorb-7n-test):
 * детермінована частина живе у провайдері (делта-гейт концерну `coverage`),
 * LLM-довизначення неоднозначних файлів — у fix-шляху концерну.
 */

/** Рядки чистого module-wiring — без тестовної логіки. */
const WIRING_RE = /^(import\b|export\s+(?:\{[^}]*\}|\*|type\b|interface\b|enum\b))/
/** Блок-коментарі `/* … *​/` (для stripComments). */
const BLOCK_COMMENT_RE = /\/\*[^*]*\*+(?:[^*/][^*]*\*+)*\//g
/** Рядкові коментарі `// …` (для stripComments). */
const LINE_COMMENT_RE = /\/\/[^\n]*/g
/** Розгалуження (`if`/`switch`) — сигнал тестовної логіки. */
const BRANCHES_RE = /\bif\s*\(|\bswitch\s*\(/
/** Тіла функцій (декларація або стрілка з блоком). */
const FUNCTIONS_RE = /\bfunction\b[^(]*\(|=>\s*\{/

/**
 * Прибирає JS/TS-коментарі перед евристичним аналізом.
 * @param {string} src джерело
 * @returns {string} джерело без коментарів
 */
function stripComments(src) {
  return src.replaceAll(BLOCK_COMMENT_RE, ' ').replaceAll(LINE_COMMENT_RE, '')
}

/**
 * Класифікує очевидні випадки; неоднозначні → `null` (вирішує LLM у fix-шляху).
 * @param {string} content джерело файлу
 * @returns {{ needsTests: boolean, reason: string } | null} вердикт або null
 */
export function quickClassify(content) {
  const stripped = stripComments(content)
  const lines = stripped
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)

  // Всі рядки — імпорти/реекспорти → тестовної логіки немає
  if (lines.length > 0 && lines.every(l => WIRING_RE.test(l))) {
    return { needsTests: false, reason: 'лише імпорти/реекспорти без логіки' }
  }

  // Є розгалуження І тіла функцій → тести очевидно потрібні
  const hasBranches = BRANCHES_RE.test(stripped)
  const hasFunctions = FUNCTIONS_RE.test(stripped)
  if (hasBranches && hasFunctions) {
    return { needsTests: true, reason: 'містить функції з розгалуженнями' }
  }

  return null
}
