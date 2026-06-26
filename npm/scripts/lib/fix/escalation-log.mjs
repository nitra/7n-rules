/**
 * Append-only JSONL-лог ескалації конформність-фіксу (спека
 * 2026-06-19-fix-escalation-cascade-design). Один запис **на рунг драбини** —
 * фіксує `model`, `withFeedback`, чи виклик удався (`callOk`/`callError`), чи
 * правило стало зеленим після цього рунга (`recheckOk` = «чи допомогло»),
 * залишковий violation і `diagnosis` (само-аналіз моделі «чому не вдалося»).
 *
 * Це доповнення до always-on wire-trace (`lib/pi-trace.mjs`): trace знає
 * `messages`/`reasoning`/`usage` кожного виклику, але **не** знає результату
 * re-check — а саме «чи допомогло» й потрібне для пост-аналізу драбини. Join із
 * trace — за полем `caller` (`fix:<rule>:<rung>`), яке цей модуль і формує.
 *
 * Шлях — дзеркало `tracePath()`: `N_CURSOR_FIX_ESCALATION_LOG` (kill-switch
 * `0|false|off|no` → не писати; інакше явний шлях) → дефолт
 * `<cwd>/.n-cursor/fix-escalation.jsonl`.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cwd, env } from 'node:process'

/** Значення `N_CURSOR_FIX_ESCALATION_LOG`, що вимикають лог повністю. */
const KILL_VALUES = new Set(['0', 'false', 'off', 'no'])

/** Межа обрізки `remainingViolation`/`diagnosis` у записі (символів). */
const MAX_FIELD_CHARS = 2000

/**
 * Шлях активного escalation-логу або `null`, якщо вимкнено kill-switch-ем.
 * @returns {string|null} шлях до .jsonl або null
 */
export function escalationLogPath() {
  const override = env.N_CURSOR_FIX_ESCALATION_LOG
  if (override !== undefined) {
    if (KILL_VALUES.has(override.toLowerCase())) return null
    if (override) return override
  }
  return join(cwd(), '.n-cursor', 'fix-escalation.jsonl')
}

/**
 * Обрізає рядок до `MAX_FIELD_CHARS` (null/undefined → null).
 * @param {string|null|undefined} s вхід
 * @returns {string|null} обрізаний рядок або null
 */
function cap(s) {
  if (s === null || s === undefined) return null
  return s.length > MAX_FIELD_CHARS ? s.slice(0, MAX_FIELD_CHARS) : s
}

/**
 * Дописує один запис рунга у JSONL-лог (no-op, якщо вимкнено). Помилки запису
 * ковтаються — лог діагностичний, не має валити сам фікс.
 * @param {object} rec запис рунга
 * @param {string} rec.ts ISO-час завершення рунга
 * @param {string} rec.ruleId id правила
 * @param {number} rec.rung індекс рунга драбини (0-based)
 * @param {string} rec.tier мітка тиру (`local-min`|`local-min-retry`|`cloud-min`|`cloud-avg`)
 * @param {string} rec.model model-id (порожній → pi-дефолт)
 * @param {boolean} rec.withFeedback чи передавався feedback попереднього рунга
 * @param {boolean} rec.callOk чи виклик моделі+apply удався
 * @param {string|null} rec.callError помилка виклику (null, якщо callOk)
 * @param {boolean} rec.recheckOk чи правило стало зеленим після рунга («чи допомогло»)
 * @param {string|null} rec.remainingViolation залишковий violation (null, якщо recheckOk)
 * @param {string|null} rec.diagnosis само-аналіз моделі «чому попередній рунг не вдався»
 * @param {number} rec.ms тривалість рунга (мс)
 * @returns {void}
 */
export function logEscalation(rec) {
  const path = escalationLogPath()
  if (!path) return
  const line =
    JSON.stringify({
      ts: rec.ts,
      ruleId: rec.ruleId,
      rung: rec.rung,
      tier: rec.tier,
      model: rec.model,
      withFeedback: rec.withFeedback,
      callOk: rec.callOk,
      callError: cap(rec.callError),
      recheckOk: rec.recheckOk,
      remainingViolation: rec.recheckOk ? null : cap(rec.remainingViolation),
      diagnosis: cap(rec.diagnosis),
      ms: rec.ms
    }) + '\n'
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, line, 'utf8')
  } catch {
    /* лог діагностичний — ковтаємо помилки запису */
  }
}
