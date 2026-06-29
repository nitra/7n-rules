/** @see ./docs/orchestrator.md */

import { env } from 'node:process'
import { runConformanceCheck } from './run-conformance-check.mjs'
import { runT0AutoCli } from './t0.mjs'
import { runPiAgentFix } from '../../../lib/pi-agent-fix.mjs'
import { recordFixTelemetry } from '../../../lib/pi-telemetry-store.mjs'
import { CLOUD_AVG, CLOUD_MIN, LOCAL_MIN } from '../../../lib/pi-model-tiers.mjs'
import { runDocFilesFixWorker } from '../../../rules/doc-files/docgen-fix-worker/main.mjs'

/**
 * Спеціалізований worker для правил із власним fix-пайплайном.
 * Якщо для ruleId є dedicated worker — повертає його; інакше — pi-agent.
 * @param {string} ruleId
 * @returns {(ruleId: string, violation: string, cwd: string, opts: object) => Promise<object>}
 */
function selectWorker(ruleId) {
  if (ruleId === 'doc-files') return runDocFilesFixWorker
  return runPiAgentFix
}

/**
 * Підраховує кількість елементів порушення з виводу правила — рядки "  - " як маркер списку.
 * @param {string} output вивід правила
 * @returns {number|null} кількість або null якщо не визначено
 */
function countViolationItems(output) {
  if (!output) return null
  const n = (output.match(/^\s+- /gmu) ?? []).length
  return n > 0 ? n : null
}

/**
 * Форматує ruleId з кількістю елементів якщо відома.
 * @param {{ ruleId: string, output: string }} rule
 * @returns {string}
 */
function fmtRule(rule) {
  const n = countViolationItems(rule.output)
  return n != null ? `${rule.ruleId} (${n})` : rule.ruleId
}

/**
 * Дефолтний кеп на виклики хмарної avg-моделі за один прогін (щоб драбина на N
 * правил не спалила потужну модель). Перевизначення: `--max-avg N`.
 */
const DEFAULT_MAX_AVG = 3

/**
 * Timeout усієї агентної сесії за тиром. Агентний фікс — багатоходовий
 * (read→edit→self_check, кожен turn = окремий API-раунд), тож на правилах із багатьма
 * порушеннями навіть швидкий cloud не вкладається у пару хвилин (вимір: gpt-5.4-mini
 * timeout на test/doc-files/npm-module за 120s). Тому cloud — теж 5 хв, як local;
 * основний backstop усе одно turn-ceiling (~50) у pi-agent-fix.
 * Перевизначення: `N_LOCAL_FIX_TIMEOUT_MS` / `N_CLOUD_FIX_TIMEOUT_MS`.
 */
const LOCAL_TIMEOUT_MS = Number(env.N_LOCAL_FIX_TIMEOUT_MS) || 300_000
const CLOUD_TIMEOUT_MS = Number(env.N_CLOUD_FIX_TIMEOUT_MS) || 300_000

/** Реальний транспорт-збій провайдера (мережа/сокет) — НЕ наш агентний backstop-timeout. */
const TRANSPORT_RE = /etimedout|timed out|econnrefused|connection refused/i

/**
 * Systemic — повтор тієї ж моделі марний: нема git, fail-closed guard, відсутня модель,
 * registry/session/auth. Quality — модель видала поганий фікс (retry/escalate може допомогти).
 */
const SYSTEMIC_RE = /не git-репо|fail-closed|write-guard|модель не знайдена|registry:|session:|немає ключа|api key/i

/**
 * Класифікує помилку pi-agent-fix: systemic | transport | quality (замінює
 * `classifyOmlxError` після pi-міграції — помилки приходять як винятки з `session.prompt`).
 * @param {string|null|undefined} error повідомлення помилки
 * @returns {'systemic'|'transport'|'quality'|null} клас
 */
export function classifyFixError(error) {
  if (!error) return null
  // Наш агентний backstop-timeout — НЕ транспорт-збій провайдера: модель працювала, просто
  // не встигла. Тому quality (а не transport-break) → драбина падає на наступний (сильніший)
  // rung, замість обриву; для cloud-min це означає шанс cloud-avg.
  if (/^fix timeout /i.test(error)) return 'quality'
  if (SYSTEMIC_RE.test(error)) return 'systemic'
  if (TRANSPORT_RE.test(error)) return 'transport'
  return 'quality'
}

/**
 * Чи violation придатний для LLM-фіксу: містить хоч одне actionable `❌`-порушення
 * (формат конформ-чека `❌ <file>: <інструкція>`). Без жодного ❌ — це не список
 * фіксабельних порушень, а шум/збій тула (Usage, «лок взято», порожньо). Годувати
 * таким агента = марні turns/timeout (вимір 7n-test: doc-files surface-ив Usage
 * downstream-тула → агент флоундерив 4 рунги). Тоді LLM-фікс пропускаємо.
 * @param {string|null|undefined} output violation-вивід правила
 * @returns {boolean} true — є що фіксити
 */
export function hasActionableViolation(output) {
  return /❌/u.test(output ?? '')
}

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
  const kind = classifyFixError(error)
  if (kind === 'systemic') return rung.local ? 'skip-model' : 'break'
  if (!rung.local && kind === 'transport') return 'break'
  return null
}

/**
 * Проводить ОДНЕ правило по драбині ескалації до першого зеленого re-check.
 * Кожен рунг: виклик worker (з feedback від попереднього) → re-check цього правила →
 * persist у глобальний telemetry-стор (`recordFixTelemetry`). Достроковий вихід — `decideAfterFailure`
 * (обрив на no-key, пропуск моделі на systemic) і вичерпаний avg-кеп (залогувати, не мовчки).
 * @param {{ ruleId: string, output: string }} rule провальне правило з violation-output
 * @param {string} cwd корінь проєкту
 * @param {{
 *   ladder: Array<{tier:string,model:string,feedback:boolean,local:boolean,isAvg:boolean}>,
 *   check: (rules: string[], cwd: string) => Promise<{rules: Array<{ruleId:string,ok:boolean,output:string}>}>,
 *   avgBudget: number,
 *   worker?: { runFix: Function },
 *   log?: (s: string) => void
 * }} deps worker — опційний override для тестів; у продакшні обирається через selectWorker(ruleId)
 * @returns {Promise<{ resolved: boolean, avgUsed: number }>} чи закрито правило і скільки avg-викликів витрачено
 */
export async function escalateRule(rule, cwd, deps) {
  const { ladder, worker, check, avgBudget } = deps
  const log = deps.log ?? (s => console.log(s))

  let feedback = null
  let currentViolation = rule.output
  const skipModels = new Set()
  let avgUsed = 0

  // §2-профілактика: violation без actionable ❌ (tool-crash/Usage/шум) → не годуємо
  // агента (інакше флоундерить рунги до timeout). Рапортуємо як non-actionable, не фіксимо.
  if (!hasActionableViolation(rule.output)) {
    const firstLine = rule.output.split('\n').find(l => l.trim()) ?? '(порожній вивід)'
    log(`  ⏭️  ${rule.ruleId}: LLM-фікс пропущено (немає ❌) — ${firstLine}`)
    return { resolved: false, avgUsed: 0 }
  }

  for (const rung of ladder) {
    if (skipModels.has(rung.model)) continue

    if (rung.isAvg && avgBudget - avgUsed <= 0) {
      log(`  ⏭️  ${rule.ruleId}: ${rung.tier} пропущено (avg-кеп вичерпано)`)
      continue
    }

    // self_check (advisory §4+5) — той самий verdict-helper, що й зовнішній re-check.
    const selfCheck = async () => {
      const r = await check([rule.ruleId], cwd)
      return { ok: r.rules.every(x => x.ok), output: r.rules.find(x => !x.ok)?.output ?? 'ok' }
    }
    const runFix = deps.worker?.runFix ?? selectWorker(rule.ruleId)
    const res = await runFix(rule.ruleId, currentViolation, cwd, {
      model: rung.model,
      tier: rung.tier,
      isAvg: rung.isAvg,
      feedback: rung.feedback ? feedback : null,
      caller: `fix:${rule.ruleId}:${rung.tier}`,
      timeoutMs: rung.timeoutMs,
      deps: { selfCheck }
    })
    if (rung.isAvg) avgUsed++

    // Зовнішній canonical re-check = джерело правди (§4+5).
    const recheck = await check([rule.ruleId], cwd)
    const recheckOk = recheck.rules.every(r => r.ok)
    const remaining = recheckOk ? '' : (recheck.rules.find(r => !r.ok)?.output ?? '')

    // Distillation-стор §13: persist кожну спробу (повні edits + verdict).
    if (res.telemetry) {
      recordFixTelemetry({
        ...res.telemetry,
        violationSignature: currentViolation,
        recheck: { external: recheckOk ? 'pass' : 'fail' },
        escalated: !recheckOk
      })
    }

    if (recheckOk) {
      log(`  ✅ ${rung.tier} (${rung.model || 'pi'}): ${rule.ruleId}`)
      return { resolved: true, avgUsed }
    }

    const hint = res.error ? ` ❌ ${res.error.slice(0, 120)}` : ' ❌ досі порушено'
    log(`  ⚡ ${rung.tier} (${rung.model || 'pi'}): ${rule.ruleId}${hint}`)

    // Recheck провалився → clean-slate per rung: відкотити правки цього рунга (§12).
    res.rollback?.()

    // Feedback для наступного рунга + оновлений violation.
    feedback = { previousModel: rung.model, previousError: res.error ?? null }
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

  console.log(`🔄 fix: ${failed.map(fmtRule).join(', ')}`)
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

  console.log(`❌ fix: невирішених — ${stillFailed.map(fmtRule).join(', ')}`)
  return 1
}
