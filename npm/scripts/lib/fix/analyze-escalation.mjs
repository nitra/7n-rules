/**
 * Аналітика escalation-логу (спека 2026-06-19-fix-escalation-analysis-design).
 *
 * Читає записи рунгів драбини (`escalation-log.mjs`) — за один прогін (від байтового
 * зсуву) або весь лог, — ділить на чанки за бюджетом символів і просить хмарну
 * **avg**-модель проаналізувати: як зменшити LLM-залежність fix-конформності.
 * Мета аналізу — конкретні правки пакета `@nitra/cursor`:
 *   (A) новий ДЕТЕРМІНОВАНИЙ T0-патерн (`t0.mjs`) — прибирає LLM зовсім;
 *   (B) уточнення `.mdc`-інструкцій правила, щоб локальна min-модель влучала з першого рунга;
 *   (C) зміна скрипта/чека в пакеті.
 * Результат — markdown-звіт у `.n-cursor/fix-escalation-analysis.md` (append із timestamp).
 *
 * Викликається CLI `n-cursor analyze-escalation` (весь лог) і наприкінці `lint --full`
 * (записи цього прогону). Кожен виклик моделі йде через спільний `callLlm` (wire-trace).
 */
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { cwd as processCwd, env } from 'node:process'

import { callLlm } from '../../../lib/llm.mjs'
import { CLOUD_AVG } from '../../../lib/models.mjs'
import { escalationLogPath } from './escalation-log.mjs'

/** Значення `N_CURSOR_FIX_ANALYZE`, що вимикають авто-аналіз наприкінці lint. */
const KILL_VALUES = new Set(['0', 'false', 'off', 'no'])
/** Бюджет символів на один чанк (щоб великий лог не перевищив контекст моделі). */
const DEFAULT_CHUNK_CHARS = 40_000
/** Timeout одного аналітичного виклику (мс) — аналіз може бути об'ємним. */
const ANALYZE_TIMEOUT_MS = 180_000

/** No-op логер за замовчуванням. */
const NOOP_LOG = () => {
  /* тихо */
}

/**
 * Спільна мета-інструкція для аналітичних викликів.
 */
const GOAL = [
  `You analyze logs from @nitra/cursor's automated rule-conformance fixer ("fix").`,
  `Each record = one attempt by a model to fix a rule-conformance violation on a rung of`,
  `an escalation ladder. Fields: ruleId; tier (local-min|local-min-retry|cloud-min|cloud-avg);`,
  `model; callOk (model call+apply succeeded); recheckOk (rule PASSED after this rung — "did it help");`,
  `callError; diagnosis (model's self-stated reason a prior attempt failed); remainingViolation.`,
  ``,
  `Goal: reduce LLM dependence and time-to-green. For RECURRING patterns recommend CONCRETE changes`,
  `to the @nitra/cursor package, in priority order:`,
  `(A) a new DETERMINISTIC T0-auto pattern for npm/scripts/lib/fix/t0.mjs — give a regex that matches`,
  `    the violation output + the mechanical fix. PREFERRED: removes the LLM entirely.`,
  `(B) a clarification to a rule's .mdc instructions so the LOCAL min-model succeeds on the FIRST rung.`,
  `(C) a script/check change elsewhere in the package.`,
  `Prioritise rules that escalated to cloud (cloud-min/cloud-avg) or failed repeatedly — they cost most.`,
  `Ignore rules resolved at local-min with no retry — they already work.`
].join('\n')

/**
 * Чи увімкнено авто-аналіз наприкінці lint (default — так; kill-switch `N_CURSOR_FIX_ANALYZE`).
 * @returns {boolean} true, якщо аналіз дозволено
 */
export function analysisEnabled() {
  const v = env.N_CURSOR_FIX_ANALYZE
  if (v === undefined) return true
  return !KILL_VALUES.has(v.toLowerCase())
}

/**
 * Розмір escalation-логу в байтах (0, якщо файлу немає/вимкнено) — для since-offset.
 * @param {string|null} [path] шлях логу
 * @returns {number} розмір у байтах
 */
export function escalationLogSize(path = escalationLogPath()) {
  if (!path) return 0
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

/**
 * Читає записи escalation-логу від байтового зсуву (default 0 — весь лог). Зсув завжди
 * на межі рядка (захоплюється після завершеного append), тож мультибайтні символи не б'ються.
 * Биті JSON-рядки пропускаються.
 * @param {string|null} path шлях логу
 * @param {number} [sinceOffset] байтовий зсув початку читання
 * @returns {object[]} розпарсені записи
 */
export function readEscalationRecords(path, sinceOffset = 0) {
  if (!path) return []
  let buf
  try {
    buf = readFileSync(path)
  } catch {
    return []
  }
  const text = (sinceOffset > 0 ? buf.subarray(sinceOffset) : buf).toString('utf8')
  const out = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      out.push(JSON.parse(t))
    } catch {
      /* битий рядок — пропускаємо */
    }
  }
  return out
}

/** Маркер skip-запису avg-рунга (кеп вичерпано) — НЕ фактичний виклик моделі. */
const AVG_SKIP_MARKER = 'cloud-avg cap reached'

/**
 * Рахує фактичні виклики моделей за тирами (skip-записи avg-кепу не рахуються).
 * @param {object[]} records записи рунгів
 * @returns {{ local: number, cloudMin: number, cloudAvg: number }} лічильники викликів
 */
export function summarizeCalls(records) {
  const stats = { local: 0, cloudMin: 0, cloudAvg: 0 }
  for (const r of records) {
    if (r.callError === AVG_SKIP_MARKER) continue
    if (r.tier === 'cloud-avg') stats.cloudAvg++
    else if (r.tier === 'cloud-min') stats.cloudMin++
    else if (typeof r.tier === 'string' && r.tier.startsWith('local')) stats.local++
  }
  return stats
}

/**
 * Друкує резюме викликів моделей за цей прогін (локальна / cloud-min / cloud-avg).
 * No-op, якщо викликів не було. Читає записи від `sinceOffset`.
 * @param {number} sinceOffset байтовий зсув логу перед прогоном
 * @param {(s: string) => void} log логер
 * @returns {void}
 */
export function reportRunStats(sinceOffset, log) {
  const { local, cloudMin, cloudAvg } = summarizeCalls(readEscalationRecords(escalationLogPath(), sinceOffset))
  if (local + cloudMin + cloudAvg === 0) return
  log(
    `\n📊 LLM-виклики fix-конформності (цей прогін): ` +
      `локальна ${local} · cloud-min ${cloudMin} · cloud-avg ${cloudAvg}\n`
  )
}

/**
 * Стискає запис до полів, важливих для аналізу (без ts/ms-шуму).
 * @param {object} r сирий запис рунга
 * @returns {object} компактний запис
 */
function summarizeRecord(r) {
  return {
    ruleId: r.ruleId,
    tier: r.tier,
    model: r.model,
    callOk: r.callOk,
    recheckOk: r.recheckOk,
    callError: r.callError ?? null,
    diagnosis: r.diagnosis ?? null,
    remainingViolation: r.remainingViolation ?? null
  }
}

/**
 * Ділить записи на чанки так, щоб JSON кожного чанка не перевищував `maxChars`.
 * Працює на стиснених записах (саме вони йдуть у prompt).
 * @param {object[]} records сирі записи
 * @param {number} [maxChars] бюджет символів на чанк
 * @returns {object[][]} чанки стиснених записів
 */
export function chunkRecords(records, maxChars = DEFAULT_CHUNK_CHARS) {
  const items = records.map(r => summarizeRecord(r))
  const chunks = []
  let cur = []
  let size = 0
  for (const it of items) {
    const len = JSON.stringify(it).length + 1
    if (cur.length > 0 && size + len > maxChars) {
      chunks.push(cur)
      cur = []
      size = 0
    }
    cur.push(it)
    size += len
  }
  if (cur.length > 0) chunks.push(cur)
  return chunks
}

/**
 * Prompt для аналізу одного чанка.
 * @param {object[]} items стиснені записи чанка
 * @param {number} idx індекс чанка (0-based)
 * @param {number} total всього чанків
 * @returns {string} текст prompt
 */
function buildChunkPrompt(items, idx, total) {
  return [
    GOAL,
    ``,
    `Log chunk ${idx + 1}/${total} (${items.length} records):`,
    JSON.stringify(items),
    ``,
    `Return concise markdown: per recommendation — target ruleId, type (A/B/C), and the concrete change`,
    `(for A: the regex + mechanical fix; for B: the exact .mdc clarification; for C: the script change).`
  ].join('\n')
}

/**
 * Prompt для злиття часткових аналізів у фінальний звіт.
 * @param {string[]} partials часткові аналізи чанків
 * @returns {string} текст prompt
 */
function buildSynthesisPrompt(partials) {
  return [
    GOAL,
    ``,
    `Below are partial analyses of separate log chunks. Merge, dedupe and prioritise into ONE report.`,
    ``,
    partials.map((p, i) => `--- chunk ${i + 1} ---\n${p}`).join('\n\n'),
    ``,
    `Return the final markdown report: recommendations ordered highest-impact first.`
  ].join('\n')
}

/**
 * Безпечний виклик моделі: ковтає помилку у `null` (аналіз не має валити lint).
 * @param {(messages: object[], model: string, opts: object) => string} call функція callLlm
 * @param {string} prompt текст prompt
 * @param {string} model model-id
 * @returns {string|null} текст відповіді або null
 */
function safeCall(call, prompt, model) {
  try {
    const text = call([{ role: 'user', content: prompt }], model, { timeoutMs: ANALYZE_TIMEOUT_MS, caller: 'fix-analyze' })
    return text || null
  } catch {
    return null
  }
}

/**
 * Аналізує записи: чанкінг → виклик avg-моделі по чанках → синтез (якщо чанків >1).
 * Синхронний (callLlm — spawnSync-based).
 * @param {object[]} records записи escalation-логу
 * @param {{ model?: string, callLlm?: (messages: object[], model: string, opts: object) => string, log?: (s: string) => void, maxChars?: number }} [opts]
 *   `model` — модель (default `CLOUD_AVG`); `callLlm` — інжекція для тестів; `log` — логер
 * @returns {{ report: string|null, chunks: number, reason: string }} звіт і метадані
 */
export function analyzeEscalations(records, opts = {}) {
  const model = opts.model ?? CLOUD_AVG
  const call = opts.callLlm ?? callLlm
  const log = opts.log ?? NOOP_LOG
  const maxChars = opts.maxChars ?? DEFAULT_CHUNK_CHARS

  if (records.length === 0) return { report: null, chunks: 0, reason: 'no-records' }
  if (!model) return { report: null, chunks: 0, reason: 'no-cloud-avg-model' }

  const chunks = chunkRecords(records, maxChars)
  const partials = []
  for (const [i, chunk] of chunks.entries()) {
    log(`  🔎 escalation-analysis: чанк ${i + 1}/${chunks.length} (${chunk.length} записів)`)
    const text = safeCall(call, buildChunkPrompt(chunk, i, chunks.length), model)
    if (text) partials.push(text)
  }

  if (partials.length === 0) return { report: null, chunks: chunks.length, reason: 'empty-responses' }
  const report = partials.length === 1 ? partials[0] : safeCall(call, buildSynthesisPrompt(partials), model)
  return { report, chunks: chunks.length, reason: report ? 'ok' : 'empty-responses' }
}

/**
 * Шлях markdown-звіту аналізу.
 * @param {string} [cwd] корінь
 * @returns {string} шлях .n-cursor/fix-escalation-analysis.md
 */
export function analysisReportPath(cwd = processCwd()) {
  return join(cwd, '.n-cursor', 'fix-escalation-analysis.md')
}

/**
 * Дописує звіт у markdown-файл із timestamp-заголовком.
 * @param {string} report текст звіту
 * @param {string} cwd корінь
 * @param {string} ts ISO-час
 * @returns {string} шлях файлу
 */
export function writeAnalysisReport(report, cwd, ts) {
  const path = analysisReportPath(cwd)
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `\n## Аналіз ${ts}\n\n${report}\n`, 'utf8')
  return path
}

/**
 * Спільний шлях: аналіз записів → запис звіту → лог-підсумок.
 * @param {object[]} records записи
 * @param {string} cwd корінь
 * @param {(s: string) => void} log логер
 * @returns {number} 0 — ок/пропуск, 1 — модель не дала звіт
 */
function analyzeAndReport(records, cwd, log) {
  const res = analyzeEscalations(records, { log })
  if (res.reason === 'no-records') {
    log('ℹ️  escalation-analysis: немає записів для аналізу.')
    return 0
  }
  if (res.reason === 'no-cloud-avg-model') {
    log('⚠️  escalation-analysis: N_CLOUD_AVG_MODEL не заданий — аналіз пропущено.')
    return 0
  }
  if (!res.report) {
    log('⚠️  escalation-analysis: модель не повернула звіт.')
    return 1
  }
  const reportPath = writeAnalysisReport(res.report, cwd, new Date().toISOString())
  log(`📝 escalation-analysis: звіт → ${reportPath} (${res.chunks} чанк(и))`)
  return 0
}

/**
 * CLI `n-cursor analyze-escalation` — аналізує ВЕСЬ escalation-лог і пише звіт.
 * @param {string[]} _args аргументи (зарезервовано)
 * @param {string} [cwd] корінь
 * @returns {number} exit code
 */
export function runEscalationAnalysisCli(_args, cwd = processCwd()) {
  const records = readEscalationRecords(escalationLogPath(), 0)
  return analyzeAndReport(records, cwd, s => console.log(s))
}

/**
 * Хук наприкінці `lint --full` (non-read-only): аналізує записи ЦЬОГО прогону
 * (від `sinceOffset`). Gated: kill-switch, наявність cloud-avg, наявність записів.
 * Помилки не валять lint.
 * @param {string} cwd корінь
 * @param {number} sinceOffset байтовий зсув логу перед прогоном
 * @param {(s: string) => void} log логер
 * @returns {void}
 */
export function maybeAnalyzeEscalation(cwd, sinceOffset, log) {
  if (!analysisEnabled()) return
  const records = readEscalationRecords(escalationLogPath(), sinceOffset)
  if (records.length === 0) return
  if (!CLOUD_AVG) {
    log('\nℹ️  escalation-analysis: були LLM-ескалації, але N_CLOUD_AVG_MODEL не заданий — аналіз пропущено.\n')
    return
  }
  log('\n🔬 escalation-analysis: аналізую ескалації цього прогону…\n')
  analyzeAndReport(records, cwd, log)
}
