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
 * @param {string} concernDir
 * @param {string} concernName
 * @returns {Promise<T0Pattern[]>}
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
 * @param {string} concernDir
 * @returns {Promise<import('./types.mjs').FixWorkerFn|null>}
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
 * Застосовує T0-патерни (детерміновано, permanent — поза rollback).
 * @param {T0Pattern[]} patterns
 * @param {LintViolation[]} violations свого concern-а
 * @param {LintContext} ctx
 * @param {(s: string) => void} log
 * @returns {Promise<boolean>} чи щось застосовано
 */
async function applyT0(patterns, violations, ctx, log) {
  let applied = false
  for (const p of patterns) {
    if (!p.test(violations)) continue
    const res = await p.apply(violations, ctx)
    if (res && Array.isArray(res.touchedFiles)) {
      applied = true
      if (res.message) log(`  ⚙️  T0 ${ctx.ruleId}/${ctx.concernId}: ${res.message}\n`)
    }
  }
  return applied
}

/**
 * Re-detect одного concern-а (canonical verdict). Кидає DetectorError → пробрасується.
 * @param {PlanItem} item
 * @param {string} cwd
 * @returns {Promise<LintViolation[]>}
 */
async function reDetect(item, cwd) {
  const ctx = { cwd, ruleId: item.entry.ruleId, concernId: item.entry.concern.name, files: item.files }
  const res = await runConcernDetector(item.entry.concern, ctx)
  return res.violations
}

/**
 * Проводить ОДИН concern по pipeline: T0 → S1 → ladder. Повертає чи закрито.
 * @param {PlanItem} item
 * @param {LintViolation[]} initialViolations
 * @param {object} deps
 * @param {string} deps.cwd
 * @param {Rung[]} deps.ladder
 * @param {() => number} deps.avgRemaining
 * @param {(n: number) => void} deps.spendAvg
 * @param {import('./types.mjs').FixWorkerFn|null} [deps.workerOverride] для тестів
 * @param {T0Pattern[]} [deps.t0Override] для тестів
 * @param {(s: string) => void} deps.log
 * @returns {Promise<boolean>}
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
  if (patterns.length > 0) {
    await applyT0(patterns, initialViolations, lintCtx, log)
    const afterT0 = await reDetect(item, cwd)
    if (afterT0.length === 0) {
      log(`  ✅ T0: ${ruleId}/${concernName}\n`)
      return true
    }
    initialViolations = afterT0
  }

  // ── Worker ladder ── concern-specific fix-worker.mjs, інакше дефолтний pi-agent worker.
  let worker = deps.workerOverride ?? (await loadFixWorker(concernDir))
  if (!worker) worker = (await import('./default-worker.mjs')).fixWorker
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
    } catch (err) {
      error = err.message
    }
    if (rung.isAvg) deps.spendAvg(1)

    // Canonical re-detect = джерело правди.
    let after
    try {
      after = await reDetect(item, cwd)
    } catch (err) {
      if (err instanceof DetectorError) throw err
      throw err
    }

    if (after.length === 0 && !error) {
      log(`  ✅ ${rung.tier} (${rung.model}): ${ruleId}/${concernName}\n`)
      return true
    }

    log(
      `  ⚡ ${rung.tier} (${rung.model}): ${ruleId}/${concernName}${error ? ` ❌ ${error.slice(0, 120)}` : ' ❌ досі порушено'}\n`
    )

    // Не clean → restore S1 перед наступним rung-ом (degraded не тече далі).
    snapshot.rollback()
    violations = after.length > 0 ? after : violations
    feedback = { previousModel: rung.model, previousError: error }

    const action = decideAfterFailure(rung, error)
    if (action === 'break') break
    if (action === 'skip-model') skipModels.add(rung.model)
  }

  return false
}

/**
 * Повний fix-pipeline: detect усе → fix кожен провальний concern → exit code.
 * @param {object} opts
 * @param {string} opts.rulesDir
 * @param {string} opts.cwd
 * @param {boolean} [opts.full]
 * @param {string[]} [opts.rules]
 * @param {string[]|null} [opts.files]
 * @param {boolean} [opts.verbose]
 * @param {number} [opts.maxAvg]
 * @param {(s: string) => void} [opts.log]
 * @param {object} [opts.deps] інжекти для тестів: { ladder, workerFor, t0For }
 * @returns {Promise<0|1|2>}
 */
export async function runFixPipeline(opts) {
  const { rulesDir, cwd } = opts
  const log = opts.log ?? (s => process.stdout.write(s))
  const verbose = opts.verbose === true
  const deps = opts.deps ?? {}

  const plan = await buildDetectPlan(opts)

  // ── Detect усе ──
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
    } catch (err) {
      if (err instanceof DetectorError) {
        log(`💥 ${err.message}\n`)
        return 2
      }
      throw err
    }
  }

  const failing = detected.filter(d => d.violations.length > 0)
  if (failing.length === 0) return 0

  const ladder = deps.ladder ?? buildLadder({ localMin: LOCAL_MIN, cloudMin: CLOUD_MIN, cloudAvg: CLOUD_AVG })
  let avgBudget = typeof opts.maxAvg === 'number' ? opts.maxAvg : DEFAULT_MAX_AVG

  let worst = 0
  for (const { item, violations } of failing) {
    const resolved = await fixConcern(item, violations, {
      cwd,
      ladder,
      log,
      avgRemaining: () => avgBudget,
      spendAvg: n => {
        avgBudget -= n
      },
      workerOverride: deps.workerFor ? deps.workerFor(item.entry) : undefined,
      t0Override: deps.t0For ? deps.t0For(item.entry) : undefined
    })
    if (!resolved) worst = 1
  }

  // Фінальний render невирішених.
  if (worst === 1) {
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

  return worst
}
