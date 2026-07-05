/** @see ./docs/docgen-judge.md */
/**
 * docgen-judge — опціональний семантичний verdict-гейт (spec
 * `docs/specs/2026-06-14-docgen-judge-design.md`).
 *
 * Доповнює детермінований `scoreDoc`: ловить `inaccurate`-доки (твердження, що
 * суперечать джерелу), яких структурно-лексичний скорер не бачить у принципі.
 * Активується АВТОМАТИЧНО, якщо задано `N_CLOUD_MIN_MODEL` (бо суддя потребує
 * сильнішої за генератор хмарної моделі — без неї судити нема чим). Працює лише на
 * доках що ПРОЙШЛИ det-скорер (`score ≥ threshold`) — саме там ховаються
 * false-positives. Scope строго `inaccurate` (вимір показав generic=0%). Без
 * `N_CLOUD_MIN_MODEL` → 0 змін поведінки. Патерн дзеркалить `scripts/coverage-classify`.
 */
import { env } from 'node:process'
import { runOneShot } from '@nitra/llm-lib/one-shot'
import { CLOUD_MIN } from '@nitra/llm-lib/model-tiers'

/** Модель-суддя = `N_CLOUD_MIN_MODEL` (хмарний cloud-min tier). */
export const JUDGE_MODEL = CLOUD_MIN
/** Гейт активується АВТОМАТИЧНО, коли задано `N_CLOUD_MIN_MODEL` (без нього нема надійного судді). */
export const JUDGE_ENABLED = Boolean(CLOUD_MIN)
/** Мін. впевненість, щоб verdict `inaccurate` позначив док як degraded. */
export const JUDGE_CONFIDENCE = Number(env.N_CURSOR_DOCGEN_JUDGE_THRESHOLD ?? 0.7) || 0.7

const JUDGE_SYSTEM = `You are a strict technical-documentation reviewer. You receive a SOURCE file and an auto-generated Markdown DOC describing it. Classify the DOC into exactly one verdict:
- "accurate": specific to THIS file AND every factual claim is supported by the source.
- "generic": vague/boilerplate; could describe almost any file of this kind.
- "inaccurate": contains at least one claim NOT supported by, or contradicted by, the source code (e.g. wrong return behavior, false "no network"/"read-only", invented symbols/fields).
Prefer "inaccurate" if any claim is wrong. Respond with ONLY a JSON object, no prose:
{"verdict":"accurate|generic|inaccurate","confidence":0.0-1.0,"reason":"<10-300 chars>"}`

const VERDICTS = new Set(['accurate', 'generic', 'inaccurate'])

/**
 * Витягує й валідує verdict-JSON із сирої відповіді LLM (як `parseVerdict` у coverage-classify).
 * @param {string} rawText сира текстова відповідь судді
 * @returns {{verdict: string, confidence: number, reason: string}} провалідований verdict
 * @throws {Error} якщо JSON відсутній/невалідний або не відповідає схемі
 */
export function parseDocVerdict(rawText) {
  const a = rawText.indexOf('{')
  const b = rawText.lastIndexOf('}')
  if (a === -1 || b === -1) throw new Error('judge: no JSON object in response')
  const v = JSON.parse(rawText.slice(a, b + 1))
  if (!VERDICTS.has(v.verdict)) throw new Error(`judge: bad verdict "${v.verdict}"`)
  if (typeof v.confidence !== 'number' || v.confidence < 0 || v.confidence > 1) {
    throw new Error('judge: bad confidence')
  }
  return { verdict: v.verdict, confidence: v.confidence, reason: String(v.reason ?? '').slice(0, 500) }
}

/**
 * Судить згенерований док сильною моделлю проти джерела.
 * @param {string} src вміст вихідного файлу
 * @param {string} doc згенерована документація
 * @param {{model?: string, timeoutMs?: number}} [opts] override моделі/таймауту
 * @returns {{verdict: string, confidence: number, reason: string}} verdict судді
 */
export async function judgeDoc(src, doc, { model = JUDGE_MODEL, timeoutMs = 120_000, chain = null } = {}) {
  const user = `SOURCE FILE:\n\`\`\`\n${src.slice(0, 12_000)}\n\`\`\`\n\nGENERATED DOC:\n\`\`\`md\n${doc.slice(0, 8000)}\n\`\`\`\n\nReturn the JSON verdict.`
  const res = await runOneShot({
    messages: [
      { role: 'system', content: JUDGE_SYSTEM },
      { role: 'user', content: user }
    ],
    modelSpec: model,
    timeoutMs,
    caller: 'docgen-judge',
    chain
  })
  if (res.error) throw new Error(res.error)
  return parseDocVerdict(res.content)
}

/**
 * Чи позначає verdict док як degraded (лише `inaccurate` із достатньою впевненістю).
 * @param {{verdict: string, confidence: number}|null} verdict verdict судді або null
 * @returns {boolean} true якщо док треба вважати degraded через семантичну неточність
 */
export function judgeFailsDoc(verdict) {
  return verdict !== null && verdict.verdict === 'inaccurate' && verdict.confidence >= JUDGE_CONFIDENCE
}
