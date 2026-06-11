/**
 * Wire-trace LLM-викликів: будує й пише багатий JSONL-запис на кожен виклик
 * `callLlm` (див. `npm/lib/llm.mjs`). Захоплює **обидва канали** — reasoning
 * (думки моделі) і спостережуваний слід (request/response/usage/latency/retry).
 *
 * Дизайн-спека: `docs/specs/2026-06-10-omlx-wire-trace-capture-design.md`.
 *
 * Двошарова модель:
 *   - RAW (цей модуль) → `<cwd>/.n-cursor/llm-trace.jsonl` (gitignored, локальний,
 *     недеструктивна ротація) — сирий потік, доживає до батч-агрегації.
 *   - AGGREGATE (друга спека) → `docs/omlx-insights/` (коммітиться в git, назавжди).
 *
 * Always-on: пишеться завжди. `N_CURSOR_LLM_TRACE=0|false|off|no` — kill-switch;
 * будь-яке інше значення — override-шлях замість дефолтного.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { cwd, env } from 'node:process'

/** Ліміт символів на одне `message.content` у записі (захист обсягу/чутливості). */
export const MAX_MSG_CHARS = 8000

/** Поріг недеструктивної ротації активного файлу (байти). */
export const ROTATE_BYTES = 50 * 1024 * 1024

/** Значення `N_CURSOR_LLM_TRACE`, що вимикають трасування повністю. */
const KILL_VALUES = new Set(['0', 'false', 'off', 'no'])

/**
 * Шлях активного trace-файлу або `null`, якщо трасування вимкнено kill-switch-ем.
 * Пріоритет: `N_CURSOR_LLM_TRACE` (kill-switch → null; інакше явний шлях) →
 * дефолт `<cwd>/.n-cursor/llm-trace.jsonl` (корінь споживацького проєкту).
 * @returns {string|null} абсолютний/відносний шлях до .jsonl або null
 */
export function tracePath() {
  const override = env.N_CURSOR_LLM_TRACE
  if (override !== undefined) {
    if (KILL_VALUES.has(override.toLowerCase())) return null
    if (override) return override
  }
  return join(cwd(), '.n-cursor', 'llm-trace.jsonl')
}

/**
 * Обрізає кожне `message.content` до `MAX_MSG_CHARS` і рахує sha256 повного
 * (необрізаного) масиву для дедуплікації.
 * @param {Array<{role:string, content:string}>} messages вихідні messages
 * @returns {{ messages: Array<{role:string, content:string}>, messages_sha256: string, messages_truncated: boolean }} обрізані messages, hash і прапор обрізки
 */
export function capMessages(messages) {
  const src = messages ?? []
  let truncated = false
  const capped = src.map(m => {
    const content = m?.content ?? ''
    if (content.length > MAX_MSG_CHARS) {
      truncated = true
      return { role: m.role, content: content.slice(0, MAX_MSG_CHARS) }
    }
    return { role: m?.role, content }
  })
  const messages_sha256 = createHash('sha256').update(JSON.stringify(src)).digest('hex')
  return { messages: capped, messages_sha256, messages_truncated: truncated }
}

/**
 * Будує нормалізований trace-запис. Поля, яких backend не дає (pi: reasoning/
 * usage/finish_reason), лишаються `null` за побудовою.
 * @param {object} i вхід
 * @param {string} i.ts ISO-час завершення виклику
 * @param {string} i.caller хто викликав (doc-files|fix|coverage|unknown)
 * @param {'omlx'|'pi'} i.backend бекенд
 * @param {string} i.model model-id
 * @param {number} [i.temperature] температура
 * @param {number} [i.maxTokens] ліміт виходу
 * @param {Array<{role:string, content:string}>} i.messages messages запиту
 * @param {string|null} [i.content] відповідь
 * @param {string|null} [i.reasoning] думки моделі
 * @param {string|null} [i.reasoningSource] джерело reasoning
 * @param {string|null} [i.finishReason] finish_reason
 * @param {object|null} [i.usage] usage verbatim
 * @param {number} i.ms latency
 * @param {number|null} [i.attempts] кількість спроб
 * @param {boolean} i.ok успіх
 * @param {string|null} [i.error] текст помилки
 * @returns {object} JSONL-готовий запис
 */
export function buildTraceRecord(i) {
  const capped = capMessages(i.messages)
  return {
    ts: i.ts,
    caller: i.caller,
    backend: i.backend,
    model: i.model,
    temperature: i.temperature ?? null,
    max_tokens: i.maxTokens ?? null,
    messages: capped.messages,
    messages_sha256: capped.messages_sha256,
    messages_truncated: capped.messages_truncated,
    content: i.content ?? null,
    reasoning: i.reasoning ?? null,
    reasoning_source: i.reasoningSource ?? null,
    finish_reason: i.finishReason ?? null,
    usage: i.usage ?? null,
    ms: i.ms,
    attempts: i.attempts ?? null,
    ok: i.ok,
    error: i.error ?? null
  }
}

/**
 * Імʼя архіву для ротації: `llm-trace.jsonl` → `llm-trace.<seq>.jsonl`
 * (нестандартні імена без `.jsonl` → `<file>.<seq>`).
 * @param {string} file активний trace-файл
 * @param {number} seq порядковий номер архіву
 * @returns {string} шлях архіву
 */
function archiveName(file, seq) {
  return file.endsWith('.jsonl') ? `${file.slice(0, -'.jsonl'.length)}.${seq}.jsonl` : `${file}.${seq}`
}

/**
 * Недеструктивна ротація: якщо активний файл перевищує `ROTATE_BYTES`,
 * перейменовує його в перший вільний `llm-trace.<seq>.jsonl` (без перезапису
 * наявних архівів). Відсутній файл / помилка stat — no-op.
 * @param {string} file активний trace-файл
 */
export function rotateIfNeeded(file) {
  let size
  try {
    size = statSync(file).size
  } catch {
    return // файлу ще нема — нічого ротувати
  }
  if (size <= ROTATE_BYTES) return
  let seq = 1
  while (existsSync(archiveName(file, seq))) seq++
  renameSync(file, archiveName(file, seq))
}

/**
 * Fail-safe запис одного trace-рядка. Резолвить шлях (kill-switch → no-op),
 * ротує за потреби, створює теку, append-ить JSONL. Будь-яка помилка IO
 * ковтається — трасування **ніколи** не ламає основний виклик.
 * @param {object} record запис від `buildTraceRecord`
 */
export function writeTrace(record) {
  const file = tracePath()
  if (!file) return
  try {
    rotateIfNeeded(file)
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, JSON.stringify(record) + '\n')
  } catch {
    // трейс не має ламати основний виклик
  }
}
