/** @see ./docs/pi-trace.md */

/**
 * Глобальний append-only LLM wire-trace (§7 спеки pi-migration).
 *
 * Замінює project-local `omlx-trace.mjs`: єдиний trace живе глобально
 * (`~/.n-cursor/llm-trace.jsonl`), щоб (1) прибрати службовий шум із consumer-репо,
 * (2) лишити cross-project телеметрію mineable в одному місці. Старі project-local
 * `<cwd>/.n-cursor/llm-trace.jsonl` більше не створюються.
 *
 * Записувач **best-effort**: будь-яка IO-помилка ковтається — трасування ніколи не
 * валить виклик LLM. Шлях перевизначається `N_CURSOR_TRACE_PATH` (для тестів/CI).
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { env } from 'node:process'

/**
 * Шлях глобального trace (env-override `N_CURSOR_TRACE_PATH`).
 * @returns {string} абсолютний шлях до `llm-trace.jsonl`.
 */
export function tracePath() {
  return env.N_CURSOR_TRACE_PATH || join(homedir(), '.n-cursor', 'llm-trace.jsonl')
}

/**
 * Дописує один trace-запис (JSONL). Поля за §7: `caller`, `rule`, `rung`, `model`,
 * `backend:"pi-ai"`, `kind:"agent"|"one-shot"`, `cwd`, плюс довільна корисна навантага.
 * Ніколи не кидає.
 * @param {object} record запис трасування
 * @param {string} [path] шлях (за замовч. `tracePath()`)
 * @returns {void}
 */
export function writeTrace(record, path = tracePath()) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`)
  } catch {
    // best-effort: трасування не повинно валити виклик
  }
}
