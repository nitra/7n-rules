/**
 * Zod-схема для verdict-відповіді LLM-класифікатора (coverage-classify).
 * parseVerdict — витяг JSON з raw-text LLM-відповіді + validate.
 *
 * Категорії:
 *   - worth-testing: pure logic, real branches — пиши тест
 *   - equivalent:    мутант поведінково еквівалентний (не killable)
 *   - defensive:     гілка для impossible state (не killable)
 *   - glue:          CLI entry / runStandardRule wrapper (integration covers)
 *   - wrapper:       тонкий spawn/fetch wrapper (integration covers)
 */
import { z } from 'zod'

// Трохи ширше за prompt-ліміт (500) — запас на моделі, які трохи перевищують
// інструкцію; понад це вже truncate-имо самі перед валідацією (REASON_SOFT_MAX нижче).
const REASON_SOFT_MAX = 500
const SUGGESTED_TEST_SOFT_MAX = 300

export const VerdictSchema = z.object({
  verdict: z.enum(['worth-testing', 'equivalent', 'defensive', 'glue', 'wrapper']),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(20).max(REASON_SOFT_MAX),
  suggestedTest: z.string().max(SUGGESTED_TEST_SOFT_MAX).optional()
})

const VALID_JSON_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'])

/**
 * Перший non-whitespace символ від `from` (для рішення "ця `"` закриває
 * рядок чи це буквальна лапка всередині значення").
 * @param {string} text текст
 * @param {number} from індекс, з якого шукати
 * @returns {string | undefined} символ або undefined якщо кінець тексту
 */
function peekNextStructural(text, from) {
  let i = from
  while (i < text.length && /\s/u.test(text[i])) i++
  return text[i]
}

/**
 * Одночасно (1) ремонтує типові LLM-огріхи всередині JSON string-літералів
 * (неекрановані `"`/backslash/control-символи — джерело "Bad escaped character"
 * і "Expected ',' or '}'" помилок JSON.parse) і (2) обрізає candidate на
 * balanced-brace межі першого `{…}`, ігноруючи prose після нього.
 * @param {string} text candidate-текст, що починається з `{`
 * @returns {string} repaired JSON-текст (balanced або best-effort до кінця тексту)
 */
function repairAndBalance(text) {
  let out = ''
  let inString = false
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (inString) {
      if (ch === '\\') {
        const next = text[i + 1]
        if (next !== undefined && VALID_JSON_ESCAPES.has(next)) {
          out += ch + next
          i++
        } else {
          out += '\\\\' // невалідний escape (напр. \d, \s) → буквальний backslash
        }
        continue
      }
      if (ch === '"') {
        const nextStructural = peekNextStructural(text, i + 1)
        const closesString = nextStructural === undefined || ',}]:'.includes(nextStructural)
        if (closesString) {
          inString = false
          out += ch
        } else {
          out += '\\"' // буквальна лапка всередині значення (напр. цитата коду)
        }
        continue
      }
      if (ch === '\n') {
        out += '\\n'
        continue
      }
      if (ch === '\r') {
        out += '\\r'
        continue
      }
      if (ch === '\t') {
        out += '\\t'
        continue
      }
      out += ch
      continue
    }

    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '{') {
      depth++
      out += ch
      continue
    }
    if (ch === '}') {
      depth--
      out += ch
      if (depth === 0) return out
      continue
    }
    if (ch === ',' && '}]'.includes(peekNextStructural(text, i + 1) ?? '')) {
      continue // trailing comma перед закриттям — прибираємо
    }
    out += ch
  }
  return out
}

/**
 * Витягує JSON-об'єкт з raw-text LLM-відповіді. Толерантний до markdown
 * code fences і prose до/після JSON-блоку.
 * @param {string} rawText raw-text відповідь LLM
 * @returns {string | null} candidate-текст, що починається з першого `{`, або null
 */
function extractJsonCandidate(rawText) {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/iu)
  const text = fenced ? fenced[1] : rawText
  const start = text.indexOf('{')
  return start === -1 ? null : text.slice(start)
}

/**
 * Витягує JSON-об'єкт з raw-text LLM-відповіді і валідує через VerdictSchema.
 * Толерантний до markdown fences, prose навколо JSON, неекранованих лапок/
 * backslash/control-символів усередині string-значень (типові LLM-огріхи, що
 * ламають наївний `JSON.parse`).
 * @param {string} rawText raw-text відповідь LLM
 * @returns {{verdict: string, confidence: number, reason: string, suggestedTest?: string}} verdict
 * @throws {Error} якщо JSON не знайдено, не парситься навіть після repair, або не відповідає схемі
 */
export function parseVerdict(rawText) {
  const candidate = extractJsonCandidate(rawText)
  if (!candidate) {
    throw new Error('No JSON object found in LLM response')
  }
  const repaired = repairAndBalance(candidate)
  const json = JSON.parse(repaired)

  if (json && typeof json === 'object') {
    if (typeof json.reason === 'string' && json.reason.length > REASON_SOFT_MAX) {
      json.reason = json.reason.slice(0, REASON_SOFT_MAX)
    }
    if (typeof json.suggestedTest === 'string' && json.suggestedTest.length > SUGGESTED_TEST_SOFT_MAX) {
      json.suggestedTest = json.suggestedTest.slice(0, SUGGESTED_TEST_SOFT_MAX)
    }
  }

  return VerdictSchema.parse(json)
}
