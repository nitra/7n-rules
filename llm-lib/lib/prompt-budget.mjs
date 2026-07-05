/** @see ./docs/prompt-budget.md */

/**
 * Спільний бюджет LLM-промптів (перенесено з `@7n/test`): єдина точка правди
 * для ліміту символів промпту та стелі відповіді (`maxTokens`) за типом
 * задачі. Захищає від класу проблем «безлімітна секція роздула промпт до
 * memory guard» — кожен колер бере бюджет звідси замість власних
 * розрізнених констант.
 *
 * Дві незалежні утиліти:
 * - `fitToBudget` — внутрішньопромптове обрізання: дропає/вкорочує
 *   низькопріоритетні chunks, поки промпт не влізе в ліміт;
 * - `packBatch` — батчинг цілих одиниць (файлів): скільки влазить зараз,
 *   решта — у наступний прохід.
 */

/** Бюджети за типом задачі: ліміт символів промпту і стеля відповіді. */
const BUDGETS = {
  header: { maxPromptChars: 8000, maxTokens: 2048 },
  block: { maxPromptChars: 40_000, maxTokens: 8192 },
  'single-file': { maxPromptChars: 60_000, maxTokens: 16_384 },
  fix: { maxPromptChars: 60_000, maxTokens: 16_384 }
}

/** Частка голови chunk-а, що лишається при обрізанні (решта — хвіст + маркер). */
const TRUNCATE_HEAD_RATIO = 0.7
/** Мінімальний розмір, до якого має сенс обрізати chunk (менше — просто дроп). */
const MIN_TRUNCATED_CHARS = 400

/**
 * Повертає бюджет для типу задачі.
 * @param {'header'|'block'|'single-file'|'fix'} taskKind тип LLM-задачі
 * @returns {{maxPromptChars: number, maxTokens: number}} копія бюджету
 */
export function budgetFor(taskKind) {
  const budget = BUDGETS[taskKind]
  if (!budget) throw new Error(`prompt-budget: невідомий taskKind "${taskKind}"`)
  return { ...budget }
}

/**
 * Символьно-безпечне обрізання середини: голова + маркер + хвіст.
 * @param {string} text вихідний текст
 * @param {number} maxChars цільовий розмір
 * @returns {string} обрізаний текст із маркером
 */
export function capText(text, maxChars) {
  return truncateMiddle(text, maxChars)
}

/**
 * Внутрішня реалізація `capText` (окреме ім'я — щоб `fitToBudget` не
 * залежав від публічного контракту).
 * @param {string} text вихідний текст
 * @param {number} maxChars цільовий розмір
 * @returns {string} обрізаний текст із маркером
 */
function truncateMiddle(text, maxChars) {
  const chars = [...text]
  if (chars.length <= maxChars) return text
  const head = Math.floor(maxChars * TRUNCATE_HEAD_RATIO)
  const tail = Math.max(0, maxChars - head)
  const dropped = chars.length - head - tail
  return `${chars.slice(0, head).join('')}\n...[обрізано ${dropped} символів]...\n${chars.slice(chars.length - tail).join('')}`
}

/**
 * Вкладає chunks у бюджет: спершу обрізає, потім дропає найнижчі
 * пріоритети, поки сумарний текст не влізе. Chunk із НАЙВИЩИМ
 * пріоритетом (сама задача / останній user-запит) захищений — його
 * текст не ріжеться і не дропається ніколи.
 * @param {Array<{text: string, priority: number, label?: string}>} chunks частини промпту; нижчий priority ріжеться першим
 * @param {number} maxChars бюджет символів на весь результат
 * @returns {{text: string, dropped: string[]}} зібраний промпт + мітки скорочених/викинутих частин
 */
export function fitToBudget(chunks, maxChars) {
  const parts = chunks.map((c, i) => ({ ...c, label: c.label ?? `chunk#${i}`, kept: true, out: c.text }))
  const maxPriority = Math.max(...parts.map(p => p.priority))
  const total = () => parts.filter(p => p.kept).reduce((sum, p) => sum + p.out.length + 1, 0)
  const dropped = []

  const candidates = parts.filter(p => p.priority < maxPriority).toSorted((a, b) => a.priority - b.priority)
  // Прохід 1: обрізати кандидатів (від найнижчого пріоритету)
  for (const part of candidates) {
    if (total() <= maxChars) break
    const overflow = total() - maxChars
    const target = Math.max(MIN_TRUNCATED_CHARS, part.out.length - overflow)
    if (part.out.length > target) {
      part.out = truncateMiddle(part.out, target)
      dropped.push(`${part.label} (обрізано)`)
    }
  }
  // Прохід 2: дропнути кандидатів цілком, якщо обрізання не вистачило
  for (const part of candidates) {
    if (total() <= maxChars) break
    part.kept = false
    dropped.push(`${part.label} (видалено)`)
  }

  return {
    text: parts
      .filter(p => p.kept)
      .map(p => p.out)
      .join('\n'),
    dropped
  }
}

/**
 * Пакує одиниці (файли) у бюджет: найменші першими, щоб максимізувати
 * кількість виправлень за один виклик. Одиниця, що сама-одна перевищує
 * бюджет, потрапляє в `deferred` — колер робить для неї соло-виклик із
 * жорсткішим внутрішнім обрізанням (`fitToBudget`), а не мовчазний skip.
 * @param {Array<{key: string, size: number}>} items одиниці з розмірами
 * @param {number} maxChars бюджет символів на батч
 * @returns {{included: string[], deferred: string[]}} ключі включених і відкладених одиниць
 */
export function packBatch(items, maxChars) {
  const sorted = items.toSorted((a, b) => a.size - b.size)
  const included = []
  const deferred = []
  let used = 0
  for (const item of sorted) {
    if (item.size + (included.length === 0 ? 0 : used) <= maxChars) {
      included.push(item.key)
      used += item.size
    } else {
      deferred.push(item.key)
    }
  }
  return { included, deferred }
}
