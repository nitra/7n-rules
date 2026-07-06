/** @see ./docs/compress-context.md */

/**
 * Стиснення pi-контексту (`context.messages` + `context.systemPrompt`) перед
 * префілом: minify вбудованого pretty-printed JSON у текстових частинах +
 * обрізання старих великих блоків. Клієнтський еквівалент колишньої
 * проксі-компресії (myllm `compress.rs`) — портовано з адаптацією під
 * форму pi, а не 1:1 (обидві форми суттєво різні, підтверджено спайком
 * 2026-07-06):
 *
 *   - pi `context.messages[].content` — ЗАВЖДИ масив parts
 *     (`{type:'text', text}` / `{type:'toolCall', id, name, arguments}`),
 *     ніколи plain string; OpenAI-body допускав і те, і те.
 *   - pi не має role `system`/`tool` у messages — system-промпт живе
 *     окремо в `context.systemPrompt` (string), а tool-результат — окремий
 *     role `toolResult`.
 *   - Немає еквівалента `response_format` на рівні pi Context (структурований
 *     вивід — інша турбота іншого шару) — відповідний skip не переносимо.
 *
 * INTERNAL — приймає/повертає pi Context, тому не входить у публічний API
 * пакета. Wiring — mixin `applyCompression` (дзеркало max-tokens.mjs).
 */

/** Скільки останніх messages лишаємо повністю захищеними від truncation (лише minify). */
const PROTECTED_TAIL_MESSAGES = 2
/** Поріг розміру тексту (символів), з якого блок — кандидат на обрізання. */
const TRUNCATE_THRESHOLD = 4000
const TRUNCATE_HEAD = 1500
const TRUNCATE_TAIL = 500
/** Мінімальна довжина вбудованого JSON-блоку, щоб турбуватись мінімізацією. */
const MIN_JSON_MINIFY_LEN = 40
/**
 * Поріг сумарного розміру контексту (символів, серіалізований проксі —
 * найближчий доступний аналог "на дроті" без окремого HTTP-тіла), понад
 * який `systemPrompt` перестає бути захищеним від truncation. Те саме
 * емпіричне обґрунтування, що в колишній проксі-компресії: коли контекст і
 * так у ризиковій зоні prefill_memory_exceeded, часткова втрата каталогу
 * skills у системному промпті — менша шкода за повну відмову prefill.
 */
const SYSTEM_TRUNCATION_SIZE_THRESHOLD = 120_000

/** Наступний потенційний початок вбудованого JSON-значення (`{`/`[`). */
const JSON_OPEN_RE = /[{[]/

/**
 * Ріже великий текст навпіл, лишаючи початок+кінець з міткою — символьно
 * безпечно (по code points, не по індексах рядка, щоб не розрізати сурогатні пари).
 * @param {string} text вихідний текст
 * @returns {string} обрізаний текст або той самий, якщо коротший за поріг
 */
function truncateMiddle(text) {
  const chars = [...text]
  if (chars.length <= TRUNCATE_HEAD + TRUNCATE_TAIL) return text
  const head = chars.slice(0, TRUNCATE_HEAD).join('')
  const tail = chars.slice(chars.length - TRUNCATE_TAIL).join('')
  const dropped = chars.length - TRUNCATE_HEAD - TRUNCATE_TAIL
  return `${head}\n...[truncated ${dropped} chars]...\n${tail}`
}

/**
 * Знаходить top-level JSON-значення, вбудовані у вільний текст (напр.
 * pretty-printed тіло запиту в аналітичному промпті), і мінімізує їх —
 * прибирає форматувальні пробіли без втрати даних. Решта тексту незмінна.
 * @param {string} text вихідний текст
 * @returns {{text: string, changed: boolean}} мінімізований текст і чи змінено
 */
function minifyEmbeddedJson(text) {
  let result = ''
  let changed = false
  let rest = text
  for (;;) {
    const idx = rest.search(JSON_OPEN_RE)
    if (idx === -1) break
    result += rest.slice(0, idx)
    const candidate = rest.slice(idx)
    const consumed = tryParseJsonPrefix(candidate)
    if (consumed === 0) {
      // Не валідний JSON з цієї позиції — лишаємо саму дужку й рухаємось далі.
      result += candidate[0]
      rest = candidate.slice(1)
      continue
    }
    const raw = candidate.slice(0, consumed)
    const minified = minifyJsonBlock(raw)
    result += minified ?? raw
    changed ||= minified !== null
    rest = candidate.slice(consumed)
  }
  result += rest
  return { text: result, changed }
}

/**
 * Мінімізує валідний JSON-блок, якщо він досить великий/багаторядковий і
 * мінімізація справді коротша за оригінал — інакше не варто турбуватись.
 * @param {string} raw валідний JSON-текст
 * @returns {string|null} мінімізований текст, або null (не застосовано)
 */
function minifyJsonBlock(raw) {
  if (raw.length < MIN_JSON_MINIFY_LEN || !raw.includes('\n')) return null
  try {
    const minified = JSON.stringify(JSON.parse(raw))
    return minified.length < raw.length ? minified : null
  } catch {
    // невалідний JSON чи не серіалізується назад компактніше — лишаємо як є
    return null
  }
}

/**
 * Пробує розпарсити JSON-значення з початку рядка (без вимоги, щоб рядок
 * закінчувався саме там) і повертає кількість спожитих символів, або 0.
 * @param {string} candidate текст, що починається з `{` або `[`
 * @returns {number} довжина валідного JSON-префікса, або 0
 */
function tryParseJsonPrefix(candidate) {
  // JSON.parse вимагає, щоб увесь рядок був валідним JSON — бінарний пошук
  // найдовшого валідного префікса по balance дужок замість посимвольного
  // JSON.parse (дорого на великих блоках), рахуємо глибину і пробуємо на
  // кожному поверненні до глибини 0.
  const openCh = candidate[0]
  const closeCh = openCh === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === openCh) {
      depth++
      continue
    }
    if (ch !== closeCh) continue
    depth--
    if (depth !== 0) continue
    return validJsonPrefixLength(candidate, i + 1)
  }
  return 0
}

/**
 * Перевіряє, що префікс завдовжки `length` — самодостатній валідний JSON
 * (баланс дужок уже 0 у виклику, лишається лише синтаксична перевірка).
 * @param {string} candidate вихідний текст
 * @param {number} length довжина префікса
 * @returns {number} `length`, якщо валідний JSON, інакше 0
 */
function validJsonPrefixLength(candidate, length) {
  try {
    JSON.parse(candidate.slice(0, length))
    return length
  } catch {
    return 0
  }
}

/**
 * Стискає один текстовий блок: minify завжди; truncate лише коли
 * не-захищений і довший за поріг.
 * @param {string} text вихідний текст
 * @param {boolean} protectedText true — не обрізати (лише minify)
 * @returns {{text: string, changed: boolean}} результат
 */
function compressText(text, protectedText) {
  const { text: minified, changed } = minifyEmbeddedJson(text)
  if (protectedText || [...minified].length <= TRUNCATE_THRESHOLD) return { text: minified, changed }
  return { text: truncateMiddle(minified), changed: true }
}

/**
 * `true`, коли message несе tool-виклик чи є його результатом — content
 * тут прив'язаний до exact-match аргументів/виконаного інструменту, чіпати не можна.
 * @param {{role: string, content: Array<object>}} message pi message
 * @returns {boolean} true — пропустити byte-exact
 */
function hasToolPayload(message) {
  if (message.role === 'toolResult') return true
  return Array.isArray(message.content) && message.content.some(p => p?.type === 'toolCall')
}

/**
 * Стискає parts одного message (лише частини `type:'text'`).
 * @param {Array<object>} parts content-parts message-а
 * @param {boolean} protectedMsg true — не обрізати (лише minify)
 * @returns {{parts: Array<object>, changed: boolean}} нові parts і чи змінено
 */
function compressParts(parts, protectedMsg) {
  let changed = false
  const newParts = parts.map(part => {
    if (part?.type !== 'text' || typeof part.text !== 'string') return part
    const r = compressText(part.text, protectedMsg)
    if (!r.changed) return part
    changed = true
    return { ...part, text: r.text }
  })
  return { parts: newParts, changed }
}

/**
 * Стискає pi Context: `systemPrompt` (захищений до порогу розміру) +
 * `messages` (tool-payload byte-exact, tail-messages лише minify, решта
 * minify+truncate). Повертає той самий обʼєкт, якщо нічого не змінилось
 * (щоб caller міг дешево перевірити `result === context`).
 * @param {{systemPrompt?: string, messages: Array<object>}} context pi Context
 * @returns {{systemPrompt?: string, messages: Array<object>}} стиснений контекст (новий або той самий)
 */
export function compressContext(context) {
  const messages = context?.messages
  if (!Array.isArray(messages)) return context

  const originalSize = (context.systemPrompt?.length ?? 0) + JSON.stringify(messages).length
  const systemProtected = originalSize <= SYSTEM_TRUNCATION_SIZE_THRESHOLD
  const lastUnprotected = Math.max(0, messages.length - PROTECTED_TAIL_MESSAGES)

  let changed = false
  const newMessages = messages.map((message, i) => {
    if (hasToolPayload(message)) return message
    if (!Array.isArray(message.content)) return message
    const protectedMsg = i >= lastUnprotected
    const r = compressParts(message.content, protectedMsg)
    if (!r.changed) return message
    changed = true
    return { ...message, content: r.parts }
  })

  let newSystemPrompt = context.systemPrompt
  if (typeof context.systemPrompt === 'string') {
    const r = compressText(context.systemPrompt, systemProtected)
    if (r.changed) {
      changed = true
      newSystemPrompt = r.text
    }
  }

  if (!changed) return context
  return { ...context, systemPrompt: newSystemPrompt, messages: newMessages }
}
