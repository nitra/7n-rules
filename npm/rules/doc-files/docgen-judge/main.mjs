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
import { runOneShot } from '@7n/llm-lib/one-shot'
import { CLOUD_MIN } from '@7n/llm-lib/model-tiers'

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
 * Детермінований пре-гейт (0 токенів) ПЕРЕД LLM-суддею: чат-філер/refusal локальної
 * моделі замість документації. Живий кейс: дока зі score=95, де секції — суцільне
 * «Я готовий писати поведінкову документацію… Надайте мені код» (gemma) — судді
 * структура здалась валідною. Другий живий кейс (2026-07-21, робота над storybook):
 * модель злила «Щоб написати точну документацію, мені потрібен сам код…» прямо в
 * тіло доки — жоден зі старих патернів не збігався. Курований безпечний список
 * (перша особа/імператив до користувача не трапляються у нормальній поведінковій
 * доці); без `\b` — кирилиця не ASCII-`\w`, JS-межі слова не спрацьовують.
 */
const REFUSAL_FILLER_RES = [
  /я готов(?:ий|а)/iu,
  /надайте(?:\s+мені)?\s+(?:код|файл|вміст|джерело)/iu,
  /надішліть(?:\s+мені)?\s+(?:код|файл)/iu,
  /будь ласка,?\s+надайте/iu,
  /не можу\s+(?:згенерувати|створити|написати)/iu,
  /чекаю на\s+(?:код|файл|вміст)/iu,
  /давайте почнемо/iu,
  // живий кейс 2026-07-21: «Щоб написати точну документацію, мені потрібен сам код…»
  /(?:мені|нам)\s+(?:потрібен|потрібно|потрібна|потрібні)\s+(?:сам(?:ий|е)?\s+)?(?:код|файл|вміст|джерел)/iu,
  /щоб написати\s+(?:точну|повну|якісну|детальну)\s+документацію/iu,
  /as an ai(?: language)? model/iu,
  /i(?:['’]m| am)\s+(?:ready to|unable to)/iu,
  /i need\s+(?:the\s+)?(?:source\s+)?(?:code|file)/iu,
  /please provide(?: the| me)?\s+(?:code|file|source)/iu
]

/**
 * Шукає у тексті доки refusal/filler-фразу моделі.
 * @param {string} text машинні секції доки (без захищеного людського «Призначення»)
 * @returns {string|null} перший збіг (для issue/діагностики) або null — фраз немає
 */
export function detectRefusalFiller(text) {
  for (const re of REFUSAL_FILLER_RES) {
    const m = text.match(re)
    if (m) return m[0]
  }
  return null
}

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
