/**
 * NNN-нумерація для артефактів вузлів графу (run_NNN.md, fact_NNN.md, тощо).
 *
 * Всі функції — чисті утиліти, файлову систему отримують через ін'єкцію.
 * NNN = рядок з ведучими нулями до 3 цифр: '001', '002', …
 */

const RUN_FILE_RE = /^run_(\d+)\.md$/
const PLAN_FILE_RE = /^plan_(\d+)\.md$/
const FACT_FILE_RE = /^fact_(\d+)\.md$/
const PENDING_AUDIT_FILE_RE = /^pending-audit_(\d+)\.md$/
const AUDIT_RESULT_FILE_RE = /^audit-result_(\d+)\.md$/

/**
 * Форматує число як NNN рядок (три цифри з ведучими нулями).
 * @param {number} n невід'ємне ціле число
 * @returns {string} '001', '002', …
 */
export function padNNN(n) {
  return String(n).padStart(3, '0')
}

/**
 * Знаходить максимальний NNN серед файлів що відповідають regex, або 0 якщо не знайдено.
 * @param {string[]} files список файлів директорії
 * @param {RegExp} re regex з групою захоплення числа
 * @returns {number} максимальний NNN або 0
 */
function maxNNN(files, re) {
  let max = 0
  for (const f of files) {
    const m = f.match(re)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return max
}

/**
 * Наступний NNN для run_NNN.md: count(run_*.md) + 1.
 * @param {string} nodeDir абсолютний шлях до директорії вузла
 * @param {(dir: string) => string[]} readdirSync ін'єктована функція readdir
 * @returns {string} наступний NNN рядок
 */
export function nextRunNNN(nodeDir, readdirSync) {
  const files = readdirSync(nodeDir)
  let count = 0
  for (const f of files) {
    if (RUN_FILE_RE.test(f)) count++
  }
  return padNNN(count + 1)
}

/**
 * Наступний NNN для plan_NNN.md: max(plan_*.md numbers) + 1.
 * @param {string} nodeDir абсолютний шлях до директорії вузла
 * @param {(dir: string) => string[]} readdirSync ін'єктована функція readdir
 * @returns {string} наступний NNN рядок
 */
export function nextPlanNNN(nodeDir, readdirSync) {
  const files = readdirSync(nodeDir)
  return padNNN(maxNNN(files, PLAN_FILE_RE) + 1)
}

/**
 * Найвищий NNN серед fact_NNN.md, або null якщо немає.
 * @param {string} nodeDir абсолютний шлях до директорії вузла
 * @param {(dir: string) => string[]} readdirSync ін'єктована функція readdir
 * @returns {string | null} NNN рядок або null
 */
export function latestFactNNN(nodeDir, readdirSync) {
  const files = readdirSync(nodeDir)
  const m = maxNNN(files, FACT_FILE_RE)
  return m > 0 ? padNNN(m) : null
}

/**
 * Перевіряє чи є pending-audit без відповідного audit-result.
 * @param {string} nodeDir абсолютний шлях до директорії вузла
 * @param {(dir: string) => string[]} readdirSync ін'єктована функція readdir
 * @returns {{ has: boolean, nnn: string | null }} результат
 */
export function hasPendingAudit(nodeDir, readdirSync) {
  const files = readdirSync(nodeDir)
  const fileSet = new Set(files)

  const pendingNNNs = []
  for (const f of files) {
    const m = f.match(PENDING_AUDIT_FILE_RE)
    if (m) pendingNNNs.push(m[1])
  }

  for (const nnn of pendingNNNs) {
    const resultFile = `audit-result_${nnn}.md`
    if (!fileSet.has(resultFile)) {
      return { has: true, nnn: padNNN(parseInt(nnn, 10)) }
    }
  }

  return { has: false, nnn: null }
}

/**
 * Знаходить NNN для останнього pending-audit_NNN.md (для audit-result).
 * @param {string} nodeDir абсолютний шлях до директорії вузла
 * @param {(dir: string) => string[]} readdirSync ін'єктована функція readdir
 * @returns {string | null} NNN рядок або null
 */
export function latestPendingAuditNNN(nodeDir, readdirSync) {
  const files = readdirSync(nodeDir)
  const m = maxNNN(files, PENDING_AUDIT_FILE_RE)
  return m > 0 ? padNNN(m) : null
}

/**
 * Знаходить NNN для останнього audit-result_NNN.md.
 * @param {string} nodeDir абсолютний шлях до директорії вузла
 * @param {(dir: string) => string[]} readdirSync ін'єктована функція readdir
 * @returns {string | null} NNN рядок або null
 */
export function latestAuditResultNNN(nodeDir, readdirSync) {
  const files = readdirSync(nodeDir)
  const m = maxNNN(files, AUDIT_RESULT_FILE_RE)
  return m > 0 ? padNNN(m) : null
}
