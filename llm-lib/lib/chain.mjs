/** @see ./docs/chain.md */

/**
 * Ланцюжок (chain) — групування кількох LLM-викликів у одну задачу з фінальним
 * результатом: виклики й перевиклики local/cloud моделей (fix-драбина, docgen
 * з best-of-2 і judge, tier1→tier2 класифікація тощо) отримують спільний
 * `chainId`, а `chain.end()` пише підсумковий запис `kind:'chain'` у глобальний
 * trace. Аналітика поверх цього: escalation-rate local→cloud, вартість cloud
 * per задача, кандидати на T0-дистиляцію.
 *
 * Використання (явний handle, БЕЗ неявного контексту):
 *   const chain = startChain({ kind: 'fix-concern', unit: 'rule/concern', cwd })
 *   try {
 *     await runOneShot({ ..., chain })   // раннер сам робить nextStep/note/trace-поля
 *     await runAgentFix(..., { chain })
 *   } finally {
 *     chain.end({ outcome: ok ? 'success' : 'fail', extra: {...} })
 *   }
 *
 * Один chain = ПОСЛІДОВНЕ використання (лічильники не atomic) — по одному
 * chain на одиницю роботи; паралельні одиниці = окремі chains.
 *
 * Кореляція з локальним проксі (myllm): раннери домішують заголовки
 * `chain.headers()` у HTTP-виклики локальних моделей; плюс кожен trace-запис
 * несе `promptHash` — офлайн-fallback джойн.
 *
 * КОНВЕНЦІЯ extra для шапки ланцюжка в UI/звітах (пише producer, напр.
 * fix-pipeline n-cursor; читають myllm ChainsPanel і chains-report; всі поля
 * опційні — старі записи без них валідні):
 *   extra.problem      — { violations, reasons[], files[], sample } — ЩО вирішували;
 *   extra.resolvedBy   — 't0' | '<tier>:<model>' — ХТО закрив (null якщо не закрито);
 *   extra.t0Applied    — [{ id, message }] — застосовані T0-патерни;
 *   extra.touchedFiles — cwd-relative шляхи реально збережених змін (кеп 20),
 *   extra.touchedTotal — повна кількість (кеп не читається як «це всі файли»).
 *
 * КОНТРАКТ promptHash (дзеркальна реалізація в myllm chains.rs — не міняти
 * односторонньо): sha256(trim(text))[0..16] lowercase, де text — content
 * ОСТАННЬОГО повідомлення з role=='user' (рядок як є; масив parts —
 * конкатенація part.text для type=='text'). Саме last-user-message, бо
 * system-обгортки substrate-у клієнт не бачить.
 */

import { createHash, randomBytes } from 'node:crypto'
import { isLocalModel } from './model-tiers.mjs'
import { writeTrace } from './trace.mjs'

/**
 * Хеш промпта за спільним контрактом кореляції (див. шапку модуля).
 * @param {string} text текст останнього user-повідомлення
 * @returns {string} sha256 hex16 lowercase від trim(text)
 */
export function promptHash(text) {
  return createHash('sha256')
    .update(String(text ?? '').trim())
    .digest('hex')
    .slice(0, 16)
}

/**
 * Порожні usage-агрегати.
 * @returns {{input: number, output: number, totalTokens: number}} нульовий акумулятор
 */
function zeroUsage() {
  return { input: 0, output: 0, totalTokens: 0 }
}

/**
 * Додає usage виклику до акумулятора (толерантно до відсутніх полів).
 * @param {{input: number, output: number, totalTokens: number}} acc акумулятор
 * @param {object|null|undefined} usage usage одного виклику
 * @returns {void}
 */
function addUsage(acc, usage) {
  if (!usage) return
  acc.input += usage.input ?? 0
  acc.output += usage.output ?? 0
  acc.totalTokens += usage.totalTokens ?? 0
}

/**
 * Створює ланцюжок задачі.
 * @param {{
 *   kind: string, unit: string, cwd?: string, meta?: object,
 *   deps?: { trace?: (record: object) => void, clock?: () => number, isLocal?: (spec: string) => boolean }
 * }} args `kind` — тип задачі ('fix-concern'|'doc-generate'|...), `unit` — ідентифікатор
 *   одиниці роботи (rule/file/mutant...), `meta` — довільний контекст у фінальний запис;
 *   `deps` — інжекти для тестів.
 * @returns {{
 *   id: string, kind: string, unit: string, cwd: string|null,
 *   nextStep: () => number,
 *   note: (call: { model?: string|null, usage?: object|null, error?: string|null, stopReason?: string|null }) => void,
 *   headers: () => Record<string, string>,
 *   traceFields: () => { chainId: string, chainKind: string, chainUnit: string, chainStep: number },
 *   end: (args: { outcome: 'success'|'fail'|'partial', extra?: object }) => object|null
 * }} chain handle
 */
export function startChain({ kind, unit, cwd, meta = {}, deps = {} }) {
  const trace = deps.trace ?? writeTrace
  const clock = deps.clock ?? (() => Date.now())
  const isLocal = deps.isLocal ?? isLocalModel

  const id = randomBytes(8).toString('hex')
  const startedAt = clock()
  let step = 0
  let localCalls = 0
  let cloudCalls = 0
  let unknownCalls = 0
  let errors = 0
  let finalModel = null
  let ended = null
  const usage = zeroUsage()
  const usageCloud = zeroUsage()

  return {
    id,
    kind,
    unit,
    cwd: cwd ?? null,

    /**
     * Наступний крок ланцюжка (кличе раннер на старті виклику).
     * @returns {number} номер кроку (1..N)
     */
    nextStep() {
      return ++step
    },

    /**
     * Раннер репортує результат кроку — акумуляція local/cloud/usage/errors.
     * `call.model` falsy (нерозв'язаний modelSpec, напр. `''`/`null` — консюмер
     * лишив вибір pi) — бакет `unknownCalls`, НЕ cloud: без факту резолву модель
     * могла піти на локальний pi-дефолт, і мовчазний запис у cloudCalls/usageCloud
     * спотворює local/cloud cost-аналітику для будь-кого, хто не передає `model`.
     * @param {{ model?: string|null, usage?: object|null, error?: string|null, stopReason?: string|null }} call результат виклику
     * @returns {void}
     */
    note(call = {}) {
      if (!call.model) {
        unknownCalls++
      } else if (isLocal(call.model)) {
        localCalls++
      } else {
        cloudCalls++
        addUsage(usageCloud, call.usage)
      }
      addUsage(usage, call.usage)
      if (call.error) errors++
      else if (call.model) finalModel = call.model
    },

    /**
     * HTTP-заголовки кореляції для локального проксі (myllm).
     * @returns {Record<string, string>} X-Chain-* заголовки поточного кроку
     */
    headers() {
      const h = {
        'X-Chain-Id': id,
        'X-Chain-Step': String(step),
        'X-Chain-Kind': kind
      }
      if (cwd) h['X-Chain-Cwd'] = encodeURIComponent(cwd)
      return h
    },

    /**
     * Поля для per-call trace-запису поточного кроку.
     * @returns {{ chainId: string, chainKind: string, chainUnit: string, chainStep: number }} chain-поля
     */
    traceFields() {
      return { chainId: id, chainKind: kind, chainUnit: unit, chainStep: step }
    },

    /**
     * Закриває ланцюжок: пише фінальний запис `kind:'chain'`. Ідемпотентний —
     * повторний виклик повертає перший підсумок без другого запису.
     * @param {{ outcome: 'success'|'fail'|'partial', extra?: object }} args фінальний вердикт задачі
     * @returns {object} підсумковий запис (для логів/тестів)
     */
    end({ outcome, extra = {} } = {}) {
      if (ended) return ended
      ended = {
        kind: 'chain',
        chainId: id,
        chainKind: kind,
        unit,
        cwd: cwd ?? null,
        outcome,
        steps: step,
        localCalls,
        cloudCalls,
        unknownCalls,
        escalated: localCalls > 0 && cloudCalls > 0,
        finalModel,
        errors,
        wallMs: clock() - startedAt,
        usage,
        usageCloud,
        meta,
        extra
      }
      trace(ended)
      return ended
    }
  }
}
