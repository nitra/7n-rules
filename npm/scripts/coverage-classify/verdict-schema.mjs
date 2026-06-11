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

export const VerdictSchema = z.object({
  verdict: z.enum(['worth-testing', 'equivalent', 'defensive', 'glue', 'wrapper']),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(20).max(500),
  suggestedTest: z.string().max(300).optional()
})

/**
 * Витягує JSON-об'єкт з raw-text LLM-відповіді і валідує через VerdictSchema.
 * @param {string} rawText raw-text відповідь LLM
 * @returns {{verdict: string, confidence: number, reason: string, suggestedTest?: string}} verdict
 * @throws {Error} якщо JSON не знайдено, не парситься, або не відповідає схемі
 */
export function parseVerdict(rawText) {
  const jsonStart = rawText.indexOf('{')
  const jsonEnd = rawText.lastIndexOf('}')
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('No JSON object found in LLM response')
  }
  const json = JSON.parse(rawText.slice(jsonStart, jsonEnd + 1))
  return VerdictSchema.parse(json)
}
