/** @see ./docs/orchestrator.md */

import { env } from 'node:process'
import { runConformanceCheck } from './run-conformance-check.mjs'
import { runT0AutoCli } from './t0.mjs'
import { logEscalation } from './escalation-log.mjs'
import { runLlmWorker } from './llm-worker.mjs'
import { classifyOmlxError } from '../../../lib/llm.mjs'
import { CLOUD_AVG, CLOUD_MIN, LOCAL_MIN } from '../../../lib/models.mjs'

/**
 * Дефолтний кеп на виклики хмарної avg-моделі за один прогін (щоб драбина на N
 * правил не спалила потужну модель). Перевизначення: `--max-avg N`.
 */
const DEFAULT_MAX_AVG = 3

/**
 * Timeout одного LLM-виклику за тиром. Локальні рунги **fail-fast**: не палити
 * стіну 120s на повільному 4b (curl exit 28) — швидше абортнути й ескалувати.
 * Хмарні — повний. Перевизначення: `N_LOCAL_FIX_TIMEOUT_MS` / `N_CLOUD_FIX_TIMEOUT_MS`.
 */
const LOCAL_TIMEOUT_MS = Number(env.N_LOCAL_FIX_TIMEOUT_MS) || 45_000
const CLOUD_TIMEOUT_MS = Number(env.N_CLOUD_FIX_TIMEOUT_MS) || 120_000

/** Маркер дружнього повідомлення про відсутній API-ключ (з `llm-worker.callModel`). */
const NO_KEY_RE = /немає ключа|api key/i

/**
 * Хмарний транспорт (pi) упав на рівні процесу: таймаут/spawn-помилка. Стіна часу
 * однакова для всіх cloud-рунгів (та сама pi-транспортна стіна), а cloud-avg — інша
 * модель, не більший timeout. Ескалація на неї лише спалить avg-бюджет → обрив.
 */
const CLOUD_TRANSPORT_RE = /etimedout|timed out|pi error/i

/**
 * Будує драбину ескалації за наявними тирами (спека 2026-06-19-fix-escalation-cascade):
 *  1. `local-min`       — `N_LOCAL_MIN_MODEL`, перший прохід;
 *  2. `local-min-retry` — той самий локальний, але з feedback попереднього рунга;
 *  3. `cloud-min`       — `N_CLOUD_MIN_MODEL` (через pi), з feedback;
 *  4. `cloud-avg`       — `N_CLOUD_AVG_MODEL` (через pi), з feedback, під avg-кепом.
 * Рунги з незаданим тиром (`''`) відсіюються — драбина стискається до доступних.
 * @param {{ localMin: string, cloudMin: string, cloudAvg: string }} models тири з env
 * @returns {Array<{ tier: string, model: string, feedback: boolean, local: boolean, isAvg: boolean, timeoutMs: number }>} драбина
 */
export function buildLadder({ localMin, cloudMin, cloudAvg }) {
  return [
    { tier: 'local-min', model: localMin, feedback: false, local: true, isAvg: false, timeoutMs: LOCAL_TIMEOUT_MS },
    {
      tier: 'local-min-retry',
      model: localMin,
      feedback: true,
      local: true,
      isAvg: false,
      timeoutMs: LOCAL_TIMEOUT_MS
    },
    { tier: 'cloud-min', model: cloudMin, feedback: true, local: false, isAvg: false, timeoutMs: CLOUD_TIMEOUT_MS },
    { tier: 'cloud-avg', model: cloudAvg, feedback: true, local: false, isAvg: true, timeoutMs: CLOUD_TIMEOUT_MS }
  ].filter(r => r.model)
}

/**
 * Рішення після провального рунга: чи обірвати драбину / пропустити модель.
 *  - `break`     — відсутній API-ключ на хмарному (інші хмарні рунги теж без ключа);
 *  - `skip-model` — systemic-помилка локального тиру (memory-guard/auth/down): повтор
 *                   тієї ж моделі марний → пропустити рунги з цим model.
 *  - `break`     — також хмарний транспорт упав (pi таймаут/spawn): решта cloud-рунгів
 *                  під тією ж стіною → обрив, щоб не палити avg-бюджет.
 * @param {{ local: boolean }} rung поточний рунг
 * @param {string|null|undefined} error помилка виклику worker
 * @returns {'break'|'skip-model'|null} дія для драбини
 */
function decideAfterFailure(rung, error) {
  if (!error) return null
  if (NO_KEY_RE.test(error)) return 'break'
  if (rung.local && classifyOmlxError(error) === 'systemic') return 'skip-model'
  if (!rung.local && CLOUD_TRANSPORT_RE.test(error)) return 'break'
  return null
}

/**
 * Проводить ОДНЕ правило по драбині ескалації до першого зеленого re-check.
 * Кожен рунг: виклик worker (з feedback від попереднього) → re-check цього правила →
 * запис у escalation-лог («чи допомогло» + diagnosis). Достроковий вихід — `decideAfterFailure`
 * (обрив на no-key, пропуск моделі на systemic) і вичерпаний avg-кеп (залогувати, не мовчки).
 * @param {{ ruleId: string, output: string }} rule провальне правило з violation-output
 * @param {string} cwd корінь проєкту
 * @param {{
 *   ladder: Array<{tier:string,model:string,feedback:boolean,local:boolean,isAvg:boolean}>,
 *   worker: { runLlmWorker: (ruleId: string, violation: string, cwd: string, opts: object) => object },
 *   check: (rules: string[], cwd: string) => Promise<{rules: Array<{ruleId:string,ok:boolean,output:string}>}>,
 *   avgBudget: number,
 *   clock?: () => number,
 *   log?: (s: string) => void
 * }} deps інжектовані залежності (worker/check/clock — для тестів)
 * @returns {Promise<{ resolved: boolean, avgUsed: number }>} чи закрито правило і скільки avg-викликів витрачено
 */
export async function escalateRule(rule, cwd, deps) {
  const { ladder, worker, check, avgBudget } = deps
  const clock = deps.clock ?? (() => Date.now())
  const log = deps.log ?? (s => console.log(s))
  const record = base => logEscalation({ ts: new Date(clock()).toISOString(), ruleId: rule.ruleId, ...base })

  let feedback = null
  let currentViolation = rule.output
  const skipModels = new Set()
  let avgUsed = 0

  for (const [idx, rung] of ladder.entries()) {
    if (skipModels.has(rung.model)) continue

    const common = { rung: idx, tier: rung.tier, model: rung.model, withFeedback: rung.feedback }
    if (rung.isAvg && avgBudget - avgUsed <= 0) {
      record({
        ...common,
        callOk: false,
        callError: 'cloud-avg cap reached',
        recheckOk: false,
        remainingViolation: currentViolation,
        diagnosis: null,
        ms: 0
      })
      log(`  ⏭️  ${rule.ruleId}: ${rung.tier} пропущено (avg-кеп вичерпано)`)
      continue
    }

    const startedAt = clock()
    const res = worker.runLlmWorker(rule.ruleId, currentViolation, cwd, {
      model: rung.model,
      feedback: rung.feedback ? feedback : null,
      caller: `fix:${rule.ruleId}:${rung.tier}`,
      timeoutMs: rung.timeoutMs
    })
    if (rung.isAvg) avgUsed++

    const recheck = await check([rule.ruleId], cwd)
    const recheckOk = recheck.rules.every(r => r.ok)
    const remaining = recheckOk ? '' : (recheck.rules.find(r => !r.ok)?.output ?? '')
    record({
      ...common,
      callOk: res.ok,
      callError: res.error ?? null,
      recheckOk,
      remainingViolation: remaining,
      diagnosis: res.diagnosis ?? null,
      ms: clock() - startedAt
    })

    if (recheckOk) {
      log(`  ✅ ${rung.tier} (${rung.model || 'pi'}): ${rule.ruleId}`)
      return { resolved: true, avgUsed }
    }

    const hint = res.error ? ` ❌ ${res.error.slice(0, 120)}` : ' ❌ досі порушено'
    log(`  ⚡ ${rung.tier} (${rung.model || 'pi'}): ${rule.ruleId}${hint}`)

    // Feedback для наступного рунга + оновлений violation.
    feedback = { previousModel: rung.model, previousChanges: res.changes ?? [], previousError: res.error ?? null }
    currentViolation = remaining || currentViolation

    const action = decideAfterFailure(rung, res.error)
    if (action === 'break') break
    if (action === 'skip-model') skipModels.add(rung.model)
  }

  return { resolved: false, avgUsed }
}

/**
 * Парсить `--max-avg N` і збирає rule-filter (позиційні аргументи без прапорців).
 * @param {string[]} args CLI аргументи після 'fix'
 * @returns {{ maxAvg: number, ruleFilter: string[] }} avg-кеп і фільтр правил
 */
export function parseOrchestratorArgs(args) {
  const idx = args.indexOf('--max-avg')
  const maxAvg = idx === -1 ? DEFAULT_MAX_AVG : Number(args[idx + 1] ?? DEFAULT_MAX_AVG) || DEFAULT_MAX_AVG
  const skip = new Set(idx === -1 ? [] : [idx, idx + 1])
  const ruleFilter = args.filter((a, i) => !a.startsWith('-') && !skip.has(i))
  return { maxAvg, ruleFilter }
}

/**
 * Крок T0-auto: детермінований фікс без LLM, повертає правила, що лишились.
 * @param {string} cwd корінь проєкту
 * @param {string[]} ruleFilter фільтр правил
 * @param {Array<{ ruleId: string }>} failed правила перед кроком
 * @returns {Promise<Array<{ ruleId: string, ok: boolean, output: string }>>} правила після T0
 */
async function runT0Step(cwd, ruleFilter, failed) {
  await runT0AutoCli([...ruleFilter], cwd)

  const afterT0 = await runConformanceCheck(ruleFilter, cwd)
  const failedAfterT0 = afterT0.rules.filter(r => !r.ok)
  const t0Fixed = failed.filter(r => !failedAfterT0.some(f => f.ruleId === r.ruleId))

  if (t0Fixed.length > 0) {
    console.log(`  ⚙️  T0-auto: ${t0Fixed.map(r => r.ruleId).join(', ')}`)
  }
  return failedAfterT0
}

/**
 * @param {string[]} args   CLI аргументи після 'fix'
 * @param {string}   cwd    корінь проєкту
 * @returns {Promise<number>}  0 = all clean, 1 = unresolved
 */
export async function runOrchestratorCli(args, cwd) {
  const worker = { runLlmWorker }
  const { maxAvg, ruleFilter } = parseOrchestratorArgs(args)
  const ladder = buildLadder({ localMin: LOCAL_MIN, cloudMin: CLOUD_MIN, cloudAvg: CLOUD_AVG })

  // ── Перша перевірка (тихо) ──
  const initial = await runConformanceCheck(ruleFilter, cwd)
  let failed = initial.rules.filter(r => !r.ok)
  const total = initial.total

  if (failed.length === 0) {
    console.log(`✅ fix: ${total} правил — все чисто`)
    return 0
  }

  console.log(`🔄 fix: ${failed.length}/${total} порушень (${failed.map(r => r.ruleId).join(', ')})`)
  if (ruleFilter.length) console.log(`   filter: ${ruleFilter.join(', ')}`)

  // ── T0-auto (детермінований, без LLM) ──
  failed = await runT0Step(cwd, ruleFilter, failed)
  if (failed.length === 0) {
    console.log(`✅ fix: ${total} правил — все чисто`)
    return 0
  }

  // ── LLM-драбина ескалації на правило ──
  if (ladder.length === 0) {
    console.log(
      `❌ fix: ${failed.length} порушень потребують LLM, але жоден тир не заданий ` +
        `(N_LOCAL_MIN_MODEL / N_CLOUD_MIN_MODEL / N_CLOUD_AVG_MODEL)`
    )
    return 1
  }
  console.log(`   драбина: ${ladder.map(r => r.tier).join(' → ')} (avg-кеп: ${maxAvg})`)

  let avgBudget = maxAvg
  for (const rule of failed) {
    const { avgUsed } = await escalateRule(rule, cwd, {
      ladder,
      worker,
      check: runConformanceCheck,
      avgBudget
    })
    avgBudget -= avgUsed
  }

  // ── Фінальна перевірка ──
  const finalCheck = await runConformanceCheck(ruleFilter, cwd)
  const stillFailed = finalCheck.rules.filter(r => !r.ok)
  if (stillFailed.length === 0) {
    console.log(`✅ fix: ${total} правил — все чисто`)
    return 0
  }

  console.log(`❌ fix: ${stillFailed.length} невирішених — ${stillFailed.map(r => r.ruleId).join(', ')}`)
  return 1
}
