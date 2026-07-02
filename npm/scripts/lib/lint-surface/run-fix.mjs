/**
 * Central fix-pipeline unified lint surface (spec 2026-06-29 §Fix Role / §Tier Ladder).
 *
 * Послідовно, per concern:
 *   detect → (clean: keep) → T0 (permanent, поза rollback) → snapshot S1 →
 *   detect → (clean: keep) → ladder[restore S1 → worker → detect]* → (exhausted: rollback S1)
 *
 * Ролі чесні: detector тільки виявляє; T0 і worker тільки змінюють; success визначає
 * ВИКЛЮЧНО canonical re-detect. Worker не володіє rollback/tier/ladder — лише один attempt.
 * @typedef {import('./types.mjs').LintContext} LintContext
 * @typedef {import('./types.mjs').LintViolation} LintViolation
 * @typedef {import('./types.mjs').FixContext} FixContext
 * @typedef {import('./types.mjs').T0Pattern} T0Pattern
 * @typedef {import('./run-detectors.mjs').PlanItem} PlanItem
 * @typedef {import('./ladder.mjs').Rung} Rung
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { LOCAL_MIN, CLOUD_MIN, CLOUD_AVG } from '../../../lib/pi-model-tiers.mjs'
import { buildDetectPlan } from './run-detectors.mjs'
import { runConcernDetector, DetectorError } from './detect.mjs'
import { renderViolations } from './render.mjs'
import { createSnapshot } from './snapshot.mjs'
import { buildLadder, decideAfterFailure, DEFAULT_MAX_AVG } from './ladder.mjs'

/**
 * Завантажує structured T0-патерни concern-а з `fix-<concern>.mjs`.
 * @param {string} concernDir Директорія concern-а, де шукати fix-модуль.
 * @param {string} concernName Ім'я concern-а для формування назви fix-файлу.
 * @returns {Promise<T0Pattern[]>} Масив T0-патернів або порожній, якщо файл відсутній.
 */
async function loadT0Patterns(concernDir, concernName) {
  const fixPath = join(concernDir, `fix-${concernName}.mjs`)
  if (!existsSync(fixPath)) return []
  try {
    // eslint-disable-next-line no-unsanitized/method
    const mod = await import(pathToFileURL(fixPath).href)
    return Array.isArray(mod.patterns) ? mod.patterns : []
  } catch {
    return []
  }
}

/**
 * Резолвить fix-worker concern-а з `fix-worker.mjs` (експорт `fixWorker`).
 * @param {string} concernDir Директорія concern-а, де шукати fix-worker.mjs.
 * @returns {Promise<import('./types.mjs').FixWorkerFn|null>} Функція-worker або null, якщо відсутня.
 */
async function loadFixWorker(concernDir) {
  const workerPath = join(concernDir, 'fix-worker.mjs')
  if (!existsSync(workerPath)) return null
  try {
    // eslint-disable-next-line no-unsanitized/method
    const mod = await import(pathToFileURL(workerPath).href)
    return typeof mod.fixWorker === 'function' ? mod.fixWorker : null
  } catch {
    return null
  }
}

/**
 * Застосовує T0-патерни (детерміновано, permanent — поза rollback). `standalone: true`
 * (spec docs/specs/2026-07-02-text-check-per-file-split-design.md §8, Phase 2) обходить
 * `test()`-гейт: патерн сам ідемпотентний і самоаналізуючий (напр. `oxfmt --write`) — не
 * потребує per-violation даних, щоб вирішити, чи запускати `apply()`.
 * @param {T0Pattern[]} patterns Список T0-патернів для перевірки й застосування.
 * @param {LintViolation[]} violations Порушення свого concern-а.
 * @param {LintContext} ctx Контекст лінту (cwd, ruleId, concernId тощо).
 * @param {(s: string) => void} log Логер для повідомлень про застосовані патерни.
 * @returns {Promise<boolean>} Чи було застосовано хоча б один патерн.
 */
async function applyT0(patterns, violations, ctx, log) {
  let applied = false
  for (const p of patterns) {
    if (!p.standalone && !p.test(violations)) continue
    const res = await p.apply(violations, ctx)
    if (res && Array.isArray(res.touchedFiles)) {
      applied = true
      if (res.message) log(`  ⚙️  T0 ${ctx.ruleId}/${ctx.concernId}: ${res.message}\n`)
    }
  }
  return applied
}

/**
 * Чи всі T0-патерни concern-а позначені `standalone: true` (і їх принаймні один) —
 * такий concern пропускає початковий detect у fix-режимі: `apply()` викликається
 * безумовно (ідемпотентно), а post-T0 re-detect сам стає джерелом правди "чи були
 * порушення" (spec §8, Phase 2). Змішаний набір (частина standalone, частина ні) —
 * НЕ підпадає: бодай один патерн, якому потрібні реальні violations, вимагає
 * початкового detect для всього concern-а.
 * @param {T0Pattern[]} patterns T0-патерни concern-а.
 * @returns {boolean} true — concern можна фіксити без початкового detect.
 */
function isStandaloneConcern(patterns) {
  return patterns.length > 0 && patterns.every(p => p.standalone === true)
}

/**
 * Re-detect одного concern-а (canonical verdict). Кидає DetectorError → пробрасується.
 * @param {PlanItem} item Елемент плану з entry та переліком файлів.
 * @param {string} cwd Робоча директорія для запуску детектора.
 * @returns {Promise<LintViolation[]>} Актуальні порушення concern-а після re-detect.
 */
async function reDetect(item, cwd) {
  const ctx = { cwd, ruleId: item.entry.ruleId, concernId: item.entry.concern.name, files: item.files }
  const res = await runConcernDetector(item.entry.concern, ctx)
  return res.violations
}

/**
 * Резолвить worker concern-а: override → concern-specific fix-worker.mjs → дефолтний pi-agent.
 * @param {string} concernDir Директорія concern-а.
 * @param {import('./types.mjs').FixWorkerFn|null} [workerOverride] Worker-override для тестів.
 * @returns {Promise<import('./types.mjs').FixWorkerFn|null>} Резолвлений worker або null.
 */
async function resolveWorker(concernDir, workerOverride) {
  const worker = workerOverride ?? (await loadFixWorker(concernDir))
  if (worker) return worker
  const defaultWorkerMod = await import('./default-worker.mjs')
  return defaultWorkerMod.fixWorker
}

/**
 * Фаза T0: застосовує детерміновані патерни й re-detect. Повертає стан фази.
 * @param {PlanItem} item Елемент плану.
 * @param {LintViolation[]} initialViolations Порушення до T0.
 * @param {T0Pattern[]} patterns T0-патерни concern-а.
 * @param {LintContext} lintCtx Контекст лінту.
 * @param {string} cwd Робоча директорія.
 * @param {(s: string) => void} log Логер.
 * @returns {Promise<{ closed: boolean, violations: LintViolation[] }>} closed=true якщо concern закрито T0; інакше актуальні violations.
 */
async function runT0Phase(item, initialViolations, patterns, lintCtx, cwd, log) {
  if (patterns.length === 0) return { closed: false, violations: initialViolations }
  await applyT0(patterns, initialViolations, lintCtx, log)
  const afterT0 = await reDetect(item, cwd)
  if (afterT0.length === 0) {
    log(`  ✅ T0: ${lintCtx.ruleId}/${lintCtx.concernId}\n`)
    return { closed: true, violations: afterT0 }
  }
  return { closed: false, violations: afterT0 }
}

/**
 * @typedef {{ previousModel: string, previousError: string|null }} FixFeedback
 */

/**
 * @typedef {{ action: 'break'|'skip-model'|null, violations: LintViolation[], feedback: FixFeedback }} RungOutcome
 */

/**
 * Проводить один rung ladder-а: worker → canonical re-detect → rollback при провалі.
 * @param {Rung} rung Поточна сходинка ladder-а.
 * @param {import('./types.mjs').FixWorkerFn} worker Fix-worker concern-а.
 * @param {LintViolation[]} violations Актуальні порушення на вході в rung.
 * @param {FixFeedback|null} feedback Feedback з попереднього rung-а.
 * @param {object} rungDeps Залежності rung-а.
 * @param {PlanItem} rungDeps.item Елемент плану.
 * @param {string} rungDeps.cwd Робоча директорія.
 * @param {ReturnType<typeof createSnapshot>} rungDeps.snapshot Snapshot S1.
 * @param {(s: string) => void} rungDeps.log Логер.
 * @returns {Promise<{ closed: true } | { closed: false, outcome: RungOutcome }>} closed=true якщо concern закрито; інакше результат для наступного кроку.
 */
async function runRung(rung, worker, violations, feedback, rungDeps) {
  const { item, cwd, snapshot, log } = rungDeps
  const { ruleId } = item.entry
  const concernName = item.entry.concern.name

  /** @type {FixContext} */
  const fixCtx = {
    cwd,
    ruleId,
    concernId: concernName,
    files: item.files,
    tier: rung.tier,
    model: rung.model,
    feedback: rung.feedback ? feedback : undefined,
    recordWrite: absPath => snapshot.record(absPath)
  }

  let error = null
  try {
    await worker(violations, fixCtx)
  } catch (workerError) {
    error = workerError.message
  }

  // Canonical re-detect = джерело правди.
  let after
  try {
    after = await reDetect(item, cwd)
  } catch (detectError) {
    if (detectError instanceof DetectorError) throw detectError
    throw detectError
  }

  if (after.length === 0 && !error) {
    log(`  ✅ ${rung.tier} (${rung.model}): ${ruleId}/${concernName}\n`)
    return { closed: true }
  }

  const errorSuffix = error ? ` ❌ ${error.slice(0, 120)}` : ' ❌ досі порушено'
  log(`  ⚡ ${rung.tier} (${rung.model}): ${ruleId}/${concernName}${errorSuffix}\n`)

  // Не clean → restore S1 перед наступним rung-ом (degraded не тече далі).
  snapshot.rollback()
  return {
    closed: false,
    outcome: {
      action: decideAfterFailure(rung, error),
      violations: after.length > 0 ? after : violations,
      feedback: { previousModel: rung.model, previousError: error }
    }
  }
}

/**
 * Проводить ОДИН concern по pipeline: T0 → S1 → ladder. Повертає чи закрито.
 * @param {PlanItem} item Елемент плану з entry та переліком файлів.
 * @param {LintViolation[]} initialViolations Початкові порушення concern-а до fix.
 * @param {object} deps Залежності pipeline.
 * @param {string} deps.cwd Робоча директорія.
 * @param {Rung[]} deps.ladder Сходинки ladder-а (tier/model послідовність).
 * @param {() => number} deps.avgRemaining Скільки avg-бюджету лишилось.
 * @param {(n: number) => void} deps.spendAvg Списати n одиниць avg-бюджету.
 * @param {import('./types.mjs').FixWorkerFn|null} [deps.workerOverride] Worker-override для тестів.
 * @param {T0Pattern[]} [deps.t0Override] T0-патерни override для тестів.
 * @param {(s: string) => void} deps.log Логер прогресу.
 * @returns {Promise<boolean>} Чи закрито concern (усі порушення усунено).
 */
export async function fixConcern(item, initialViolations, deps) {
  const { cwd, ladder, log } = deps
  const { ruleId } = item.entry
  const concernName = item.entry.concern.name
  const concernDir = item.entry.concern.dir
  /** @type {LintContext} */
  const lintCtx = { cwd, ruleId, concernId: concernName, concernDir, files: item.files }

  // ── T0 (детермінований, permanent) ──
  const patterns = deps.t0Override ?? (await loadT0Patterns(concernDir, concernName))
  const t0 = await runT0Phase(item, initialViolations, patterns, lintCtx, cwd, log)
  if (t0.closed) return true
  initialViolations = t0.violations

  // ── Fixability-гейт ── config/structural concern-и НЕ йдуть у LLM-ladder: їхній фікс
  // детермінований (T0/regen) або ризикований для авто-правки. T0 уже відпрацював вище —
  // якщо не закрив, це сигнал ручного/config-фіксу, а не привід палити tier-и (fail-fast).
  const fixability = item.entry.concern.fixability ?? 'code'
  if (fixability !== 'code') {
    log(`  ⏹️  ${ruleId}/${concernName}: fixability=${fixability} — LLM-ladder пропущено (T0/manual)\n`)
    return false
  }

  // ── Worker ladder ── concern-specific fix-worker.mjs, інакше дефолтний pi-agent worker.
  const worker = await resolveWorker(concernDir, deps.workerOverride)
  if (!worker || ladder.length === 0) return false

  // S1: знімок post-T0. Один tracker акумулює pre-images; rollback цілить у S1.
  const snapshot = createSnapshot()
  let feedback = null
  let violations = initialViolations
  const skipModels = new Set()

  for (const rung of ladder) {
    if (skipModels.has(rung.model)) continue
    if (rung.isAvg && deps.avgRemaining() <= 0) {
      log(`  ⏭️  ${ruleId}/${concernName}: ${rung.tier} пропущено (avg-кеп вичерпано)\n`)
      continue
    }

    const res = await runRung(rung, worker, violations, feedback, { item, cwd, snapshot, log })
    if (rung.isAvg) deps.spendAvg(1)
    if (res.closed) return true

    violations = res.outcome.violations
    feedback = res.outcome.feedback
    if (res.outcome.action === 'break') break
    if (res.outcome.action === 'skip-model') skipModels.add(rung.model)
  }

  return false
}

/**
 * Detect-фаза: прогін усіх concern-ів плану. При `DetectorError` — сигнал коду 2.
 * @param {PlanItem[]} plan План прогону.
 * @param {string} cwd Робоча директорія.
 * @param {boolean} verbose Детальний вивід плану.
 * @param {(s: string) => void} log Логер.
 * @returns {Promise<{ code: 2 } | { detected: Array<{ item: PlanItem, violations: LintViolation[] }> }>} код 2 при DetectorError або зібрані результати detect.
 */
async function detectAllForFix(plan, cwd, verbose, log) {
  /** @type {Array<{ item: PlanItem, violations: LintViolation[] }>} */
  const detected = []
  for (const item of plan) {
    const ctx = { cwd, ruleId: item.entry.ruleId, concernId: item.entry.concern.name, files: item.files }
    if (verbose) {
      const countStr = item.files === undefined ? 'весь репо' : `${item.files.length} файл(ів)`
      log(`  🔍 ${ctx.ruleId}/${ctx.concernId}  [${item.entry.concern.lint.scope}]  → ${countStr}\n`)
    }
    try {
      const res = await runConcernDetector(item.entry.concern, ctx)
      detected.push({ item, violations: res.violations })
    } catch (detectError) {
      if (detectError instanceof DetectorError) {
        log(`💥 ${detectError.message}\n`)
        return { code: 2 }
      }
      throw detectError
    }
  }
  return { detected }
}

/**
 * Фінальний render невирішених порушень (після провального fix-проходу).
 * @param {Array<{ item: PlanItem, violations: LintViolation[] }>} failing Провальні concern-и.
 * @param {string} cwd Робоча директорія.
 * @param {(s: string) => void} log Логер.
 * @returns {Promise<void>} нічого не повертає (тільки лог).
 */
async function renderRemaining(failing, cwd, log) {
  const remaining = []
  for (const { item } of failing) {
    try {
      remaining.push(...(await reDetect(item, cwd)))
    } catch {
      /* DetectorError на фінальному render — ігноруємо, основний verdict уже worst=1 */
    }
  }
  if (remaining.length > 0) log(renderViolations(remaining))
}

/**
 * Повний fix-pipeline: detect усе → fix кожен провальний concern → exit code.
 * @param {object} opts Опції запуску pipeline.
 * @param {string} opts.rulesDir Директорія з правилами.
 * @param {string} opts.cwd Робоча директорія.
 * @param {boolean} [opts.full] Прогін по всьому репо замість дельти.
 * @param {string[]} [opts.rules] Перелік ruleId для обмеження прогону.
 * @param {string[]|null} [opts.files] Перелік файлів або null для повного набору.
 * @param {boolean} [opts.verbose] Детальний вивід плану детекції.
 * @param {number} [opts.maxAvg] Ліміт avg-бюджету.
 * @param {(s: string) => void} [opts.log] Логер виводу.
 * @param {object} [opts.deps] Інжекти для тестів: { ladder, workerFor, t0For }.
 * @returns {Promise<0|1|2>} Exit code: 0 — чисто, 1 — лишились порушення, 2 — DetectorError.
 */
export async function runFixPipeline(opts) {
  const { cwd } = opts
  const log = opts.log ?? (s => process.stdout.write(s))
  const verbose = opts.verbose === true
  const deps = opts.deps ?? {}

  const plan = await buildDetectPlan(opts)

  // Преloadимо T0-патерни разом із планом — потрібно, щоб класифікувати standalone-концерни
  // (spec docs/specs/2026-07-02-text-check-per-file-split-design.md §8, Phase 2) ДО початкового
  // detect. Той самий preload передається далі в fixConcern як t0Override — без повторного
  // dynamic import().
  const patternsByItem = new Map(
    await Promise.all(
      plan.map(async item => [
        item,
        deps.t0For
          ? (deps.t0For(item.entry) ?? [])
          : await loadT0Patterns(item.entry.concern.dir, item.entry.concern.name)
      ])
    )
  )
  const standaloneItems = plan.filter(item => isStandaloneConcern(patternsByItem.get(item)))
  const normalPlan = plan.filter(item => !standaloneItems.includes(item))

  // ── Detect лише для normal-концернів; standalone апляє одразу (без початкового detect) ──
  const detectResult = await detectAllForFix(normalPlan, cwd, verbose, log)
  if ('code' in detectResult) return detectResult.code

  const failing = detectResult.detected.filter(d => d.violations.length > 0)
  if (failing.length === 0 && standaloneItems.length === 0) return 0

  const ladder = deps.ladder ?? buildLadder({ localMin: LOCAL_MIN, cloudMin: CLOUD_MIN, cloudAvg: CLOUD_AVG })
  let avgBudget = typeof opts.maxAvg === 'number' ? opts.maxAvg : DEFAULT_MAX_AVG

  /**
   * @param {PlanItem} item Елемент плану.
   * @param {LintViolation[]} violations Початкові порушення (порожньо для standalone).
   * @returns {Promise<boolean>} Чи закрито concern.
   */
  const runOne = (item, violations) =>
    fixConcern(item, violations, {
      cwd,
      ladder,
      log,
      avgRemaining: () => avgBudget,
      spendAvg: n => {
        avgBudget -= n
      },
      workerOverride: deps.workerFor ? deps.workerFor(item.entry) : undefined,
      t0Override: patternsByItem.get(item)
    })

  let worst = 0
  const attemptedForRender = []

  for (const { item, violations } of failing) {
    if (!(await runOne(item, violations))) {
      worst = 1
      attemptedForRender.push({ item })
    }
  }

  for (const item of standaloneItems) {
    if (verbose) {
      const label = `${item.entry.ruleId}/${item.entry.concern.name}`
      log(`  🔍 ${label}  [standalone-merge]  → apply без початкового detect\n`)
    }
    if (!(await runOne(item, []))) {
      worst = 1
      attemptedForRender.push({ item })
    }
  }

  // Фінальний render невирішених.
  if (worst === 1) await renderRemaining(attemptedForRender, cwd, log)

  return worst
}
