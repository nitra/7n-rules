/** @see ./docs/body-capture.md */

/**
 * Opt-in захоплення повних тіл LLM-викликів (prompt + response) — заміна
 * колишнього `requests.jsonl` myllm-проксі, з двома перевагами: (1) працює
 * і для CLOUD-викликів (проксі бачив лише local), (2) не залежить від
 * запущеного myllm.
 *
 * Вимкнено за замовчуванням (тіла важкі) — вмикається `N_LLM_TRACE_BODIES=1`.
 * Не pi-coupled (чиста FS-утиліта, як [trace]/[telemetry-store]) — публічний
 * модуль пакета; основні консюмери — самі раннери (кличуть напряму), зовнішні
 * читачі (напр. myllm) читають файли зі стору за тією ж конвенцією шляху.
 *
 * Стор: `~/.n-cursor/llm-bodies/<chainId ?? caller>/<step-або-ts>.json`,
 * best-effort (як [trace]/[telemetry-store] — ніколи не валить виклик).
 * Ретеншн: авто-очистка найстаріших файлів понад `N_LLM_BODIES_MAX_MB`
 * (дефолт 500MB), перевіряється лише при записі (не фоновий процес).
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { env } from 'node:process'

/**
 * Корінь стору (env-override `N_LLM_BODIES_DIR`).
 * @returns {string} абсолютний шлях до кореня body-capture стору.
 */
export function bodiesDir() {
  return env.N_LLM_BODIES_DIR || join(homedir(), '.n-cursor', 'llm-bodies')
}

/**
 * Ліміт сумарного розміру стору в байтах (env-override `N_LLM_BODIES_MAX_MB`).
 * @returns {number} ліміт у байтах.
 */
function maxBytes() {
  return (Number(env.N_LLM_BODIES_MAX_MB) || 500) * 1024 * 1024
}

/**
 * Чи body-capture увімкнено (дефолт вимкнено — важкі тіла, вмикають свідомо).
 * @returns {boolean} true — захоплення увімкнено.
 */
export function bodyCaptureEnabled() {
  return env.N_LLM_TRACE_BODIES === '1'
}

/**
 * Санітизує компонент шляху (chainId/caller/step ідуть у файлову систему).
 * @param {string} s вихідний рядок
 * @returns {string} безпечний для шляху рядок
 */
function safePathPart(s) {
  return String(s ?? 'unknown').replaceAll(/[^\w-]/g, '-')
}

/**
 * Авто-очистка стору: якщо сумарний розмір понад ліміт — видаляє
 * найстаріші файли (за mtime), поки не влізе. Best-effort, never throws.
 * @param {string} dir корінь стору
 * @returns {void}
 */
function pruneIfOverBudget(dir) {
  const budget = maxBytes()
  /** @type {Array<{ path: string, size: number, mtimeMs: number }>} */
  const files = []
  let total = 0
  for (const chainDir of readdirSync(dir)) {
    const chainPath = join(dir, chainDir)
    let entries
    try {
      entries = readdirSync(chainPath)
    } catch {
      continue
    }
    for (const f of entries) {
      const p = join(chainPath, f)
      try {
        const st = statSync(p)
        files.push({ path: p, size: st.size, mtimeMs: st.mtimeMs })
        total += st.size
      } catch {
        // файл міг зникнути між readdir і stat — пропускаємо
      }
    }
  }
  if (total <= budget) return
  files.sort((a, b) => a.mtimeMs - b.mtimeMs)
  for (const f of files) {
    if (total <= budget) break
    try {
      rmSync(f.path, { force: true })
      total -= f.size
    } catch {
      // best-effort
    }
  }
}

/**
 * Захоплює одне тіло LLM-виклику (no-op, якщо `N_LLM_TRACE_BODIES` не `'1'`).
 * @param {{
 *   chainId?: string|null, caller?: string, step?: number,
 *   model?: string|null, promptHash?: string,
 *   prompt?: string, output?: unknown, usage?: object|null, error?: string|null
 * }} record тіло виклику (prompt — те, що фактично пішло до моделі; output — текст/структура відповіді)
 * @param {{ dir?: string }} [opts] `dir` — корінь стору (дефолт `bodiesDir()`)
 * @returns {string|null} шлях збереженого файлу, або null (вимкнено/помилка)
 */
export function captureBody(record, opts = {}) {
  if (!bodyCaptureEnabled()) return null
  try {
    const dir = opts.dir ?? bodiesDir()
    const groupDir = join(dir, safePathPart(record.chainId ?? record.caller))
    mkdirSync(groupDir, { recursive: true })
    const fileName = `${safePathPart(record.step ?? Date.now())}.json`
    const path = join(groupDir, fileName)
    writeFileSync(
      path,
      JSON.stringify(
        {
          ts: new Date().toISOString(),
          caller: record.caller ?? null,
          chainId: record.chainId ?? null,
          chainStep: record.step ?? null,
          model: record.model ?? null,
          promptHash: record.promptHash ?? null,
          prompt: record.prompt ?? null,
          output: record.output ?? null,
          usage: record.usage ?? null,
          error: record.error ?? null
        },
        null,
        2
      )
    )
    if (existsSync(dir)) pruneIfOverBudget(dir)
    return path
  } catch {
    return null
  }
}
