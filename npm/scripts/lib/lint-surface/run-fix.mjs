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
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

import { LOCAL_MIN, CLOUD_MIN, CLOUD_AVG } from '@7n/llm-lib/model-tiers'
import { startChain } from '@7n/llm-lib/chain'
import { writeTrace } from '@7n/llm-lib/trace'
import { withTimeout } from '@7n/llm-lib/with-timeout'
import { buildDetectPlan } from './run-detectors.mjs'
import { runConcernDetector, DetectorError } from './detect.mjs'
import { renderViolations } from './render.mjs'
import { createSnapshot } from './snapshot.mjs'
import { findCollateralEdits, realpathBestEffort } from './collateral-veto.mjs'
import { createProgressReporter } from './progress.mjs'
import { buildLadder, decideAfterFailure, DEFAULT_MAX_AVG } from './ladder.mjs'

/**
 * Стабільний ключ одиниці прогресу для ProgressReporter.
 * @param {PlanItem} item Елемент плану.
 * @returns {string} `rule/concern`
 */
function progressKey(item) {
  return `${item.entry.ruleId}/${item.entry.concern.name}`
}

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
 * @returns {Promise<Array<{ id: string, message: string|null, touchedFiles: string[] }>>} Застосовані патерни з їхніми змінами.
 */
async function applyT0(patterns, violations, ctx, log) {
  const applied = []
  for (const p of patterns) {
    if (!p.standalone && !p.test(violations)) continue
    const res = await p.apply(violations, ctx)
    if (res && Array.isArray(res.touchedFiles)) {
      applied.push({ id: p.id, message: res.message ?? null, touchedFiles: res.touchedFiles })
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
 * Кожен знімок живить ProgressReporter — тикер «знайдено/виправлено» оновлюється
 * саме тут, після кожного canonical detect.
 * @param {PlanItem} item Елемент плану з entry та переліком файлів.
 * @param {string} cwd Робоча директорія для запуску детектора.
 * @param {import('./progress.mjs').ProgressReporter|null} [progress] Reporter прогресу.
 * @param {boolean} [verbose] Детальний вивід (прокидається у ctx concern-а).
 * @returns {Promise<LintViolation[]>} Актуальні порушення concern-а після re-detect.
 */
async function reDetect(item, cwd, progress = null, verbose = false) {
  const ctx = { cwd, ruleId: item.entry.ruleId, concernId: item.entry.concern.name, files: item.files, verbose }
  const res = await runConcernDetector(item.entry.concern, ctx)
  progress?.detectSnapshot(progressKey(item), res.violations.length)
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
 * @param {import('./progress.mjs').ProgressReporter|null} [progress] Reporter прогресу.
 * @param {boolean} [verbose] Детальний вивід (прокидається у ctx concern-а).
 * @returns {Promise<{ closed: boolean, violations: LintViolation[], applied: Array<{ id: string, message: string|null, touchedFiles: string[] }> }>} closed=true якщо concern закрито T0; applied — застосовані патерни з їхніми змінами.
 */
async function runT0Phase(item, initialViolations, patterns, lintCtx, cwd, log, progress = null, verbose = false) {
  if (patterns.length === 0) return { closed: false, violations: initialViolations, applied: [] }
  progress?.concernStart(progressKey(item), 'T0')
  const applied = await applyT0(patterns, initialViolations, lintCtx, log)
  const afterT0 = await reDetect(item, cwd, progress, verbose)
  if (afterT0.length === 0) {
    log(`  ✅ T0: ${lintCtx.ruleId}/${lintCtx.concernId}\n`)
    return { closed: true, violations: afterT0, applied }
  }
  return { closed: false, violations: afterT0, applied }
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
 * @param {import('./progress.mjs').ProgressReporter|null} [rungDeps.progress] Reporter прогресу.
 * @param {boolean} [rungDeps.verbose] Детальний вивід (прокидається у ctx concern-а).
 * @returns {Promise<{ closed: true, touchedFiles: string[] } | { closed: false, outcome: RungOutcome }>} closed=true якщо concern закрито (touchedFiles — зміни worker-а); інакше результат для наступного кроку.
 */
async function runRung(rung, worker, violations, feedback, rungDeps) {
  const { item, cwd, snapshot, log, progress = null, verbose = false, chain = null } = rungDeps
  const { ruleId } = item.entry
  const concernName = item.entry.concern.name
  progress?.concernStart(progressKey(item), rung.tier)

  /** @type {FixContext} */
  const fixCtx = {
    cwd,
    ruleId,
    concernId: concernName,
    files: item.files,
    tier: rung.tier,
    model: rung.model,
    timeoutMs: rung.timeoutMs,
    feedback: rung.feedback ? feedback : undefined,
    recordWrite: absPath => snapshot.record(absPath),
    recordDurableWrite: absPath => snapshot.recordDurable(absPath),
    chain
  }

  let workerResult = null
  let error = null
  try {
    // Первинний таймаут — у самому worker-і (ctx.timeoutMs → runAgentFix abort-ить
    // сесію). Backstop ×1.25 страхує від worker-а, що ігнорує ctx.timeoutMs
    // (ADR 260620-0556: зависла cloud-SSE без гонки блокувала lint назавжди);
    // запас гарантує, що штатно першим спрацьовує внутрішній abort-шлях.
    workerResult = await withTimeout(worker(violations, fixCtx), Math.round(rung.timeoutMs * 1.25), {
      label: 'fix'
    })
  } catch (workerError) {
    error = workerError.message
  }

  // Canonical re-detect = джерело правди.
  let after
  try {
    after = await reDetect(item, cwd, progress, verbose)
  } catch (detectError) {
    if (detectError instanceof DetectorError) throw detectError
    throw detectError
  }

  // Semantic-collateral veto (§12 addendum 2026-07-05): clean-вердикт не приймається,
  // якщо rung ЗМІНИВ наявні файли поза target-set порушення (клас «App.vue: хардкод
  // версії замість getVersion»). Нові файли дозволені (scaffold/доки); порожній
  // target-set (whole-repo концерни без file-атрибуції) → veto незастосовний.
  const targetFiles = [...new Set([...violations.map(v => v.file).filter(Boolean), ...(item.files ?? [])])]
  const collateral = findCollateralEdits({ modifiedExisting: snapshot.modifiedExisting(), targetFiles, cwd })
  // relative — від так само realpath-нормалізованого cwd, інакше symlink-cwd (macOS
  // /var → /private/var) дає `../../…`-шляхи у телеметрії та feedback.
  const rejectedRel = collateral.map(p => relative(realpathBestEffort(cwd), p))
  if (collateral.length > 0) {
    // Телеметрія відхилених правок — той самий глобальний llm-trace, що й fix-виклики.
    writeTrace({
      caller: `fix:${ruleId}/${concernName}:${rung.tier}`,
      backend: 'pi-ai',
      kind: 'collateral-veto',
      rule: ruleId,
      rung: rung.tier,
      model: rung.model,
      cwd,
      rejectedFiles: rejectedRel,
      targetFiles,
      cleanDetect: after.length === 0
    })
  }
  const vetoed = after.length === 0 && !error && collateral.length > 0
  const touchedFiles = workerResult?.touchedFiles ?? []

  if (after.length === 0 && !error && !vetoed) {
    log(`  ✅ ${rung.tier} (${rung.model}): ${ruleId}/${concernName}\n`)
    return { closed: true, touchedFiles }
  }

  let errorSuffix = ' ❌ досі порушено'
  if (error) errorSuffix = ` ❌ ${error.slice(0, 120)}`
  else if (vetoed) errorSuffix = ` 🚫 collateral-veto: ${rejectedRel.join(', ')}`
  log(`  ⚡ ${rung.tier} (${rung.model}): ${ruleId}/${concernName}${errorSuffix}\n`)

  // Не clean → restore S1 перед наступним rung-ом (degraded не тече далі).
  // Durable-write-и worker-а (recordDurableWrite) rollback НЕ чіпає: кожен такий файл —
  // самодостатній кінцевий стан (doc-files-батч), і прогрес по ньому вже зарахований
  // canonical re-detect-ом вище — наступний rung/прогін продовжує з решти, не з нуля.
  snapshot.rollback()

  // Мовчазна невдача (worker не кинув виняток, але порушення лишилось) — без цього
  // наступний rung стартує без жодного знання про попередню спробу (buildFixPrompt
  // додає `## Попередня спроба` лише коли previousError truthy).
  let silentFailureNote
  if (vetoed) {
    silentFailureNote =
      `Попередня спроба (${rung.model}) закрила порушення, але змінила наявні файли поза ` +
      `target-set (${rejectedRel.join(', ')}) — усі правки відхилено. ` +
      `Редагуй ЛИШЕ файли порушення: ${targetFiles.join(', ')}.`
  } else if (touchedFiles.length === 0) {
    silentFailureNote = `Попередня спроба (${rung.model}) не внесла жодної зміни у файли; порушення досі активне.`
  } else {
    silentFailureNote =
      `Попередня спроба (${rung.model}) торкнулась файлів (${touchedFiles.join(', ')}), ` +
      'але порушення досі активне — той самий підхід не спрацював, спробуй інакше.'
  }

  return {
    closed: false,
    outcome: {
      action: decideAfterFailure(rung, error),
      violations: after.length > 0 ? after : violations,
      feedback: { previousModel: rung.model, previousError: error ?? silentFailureNote }
    }
  }
}

/** Кеп telemetry-списку змінених файлів у extra ланцюжка (повний обсяг — touchedTotal). */
const TOUCHED_FILES_CAP = 20

/**
 * Стислий опис проблеми concern-а для шапки ланцюжка (`extra.problem` фінального
 * chain-запису) — щоб в аналітиці (myllm, chains-report) було видно, ЩО саме
 * вирішував ланцюжок, а не лише rule/concern.
 * @param {LintViolation[]} violations Порушення concern-а.
 * @returns {{ violations: number, reasons: string[], files: string[], sample: string|null }|null} Зведення або null, якщо порушень нема.
 */
function summarizeProblem(violations) {
  if (!violations?.length) return null
  return {
    violations: violations.length,
    reasons: [...new Set(violations.map(v => v.reason))].slice(0, 5),
    files: [...new Set(violations.map(v => v.file).filter(Boolean))].slice(0, 10),
    sample: violations[0]?.message?.slice(0, 200) ?? null
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
 * @param {import('./progress.mjs').ProgressReporter|null} [deps.progress] Reporter прогресу.
 * @param {boolean} [deps.verbose] Детальний вивід (прокидається у ctx concern-а).
 * @param {typeof startChain} [deps.chainFactory] Фабрика ланцюжка (інжект для тестів).
 * @returns {Promise<boolean>} Чи закрито concern (усі порушення усунено).
 */
export async function fixConcern(item, initialViolations, deps) {
  const { ruleId } = item.entry
  const concernName = item.entry.concern.name
  // Ланцюжок concern-а охоплює і T0: закриття без жодного LLM-виклику (steps:0,
  // t0Closed) — золотий baseline для метрики дистиляції.
  const chain = (deps.chainFactory ?? startChain)({
    kind: 'fix-concern',
    unit: `${ruleId}/${concernName}`,
    cwd: deps.cwd
  })
  const chainExtra = {
    t0Closed: false,
    stop: null,
    rungs: [],
    rollbacks: 0,
    avgCapSkipped: 0,
    // Шапка ланцюжка в аналітиці: яку проблему вирішували, хто закрив (t0 |
    // tier:model), і до яких змін файлів це привело (permanent T0 + closing rung;
    // rollback-нуті rung-и сюди не потрапляють).
    problem: summarizeProblem(initialViolations),
    resolvedBy: null,
    t0Applied: [],
    touchedFiles: [],
    touchedTotal: 0
  }
  // Абсолютні шляхи змін накопичуються тут і нормалізуються один раз у finally
  // (cwd-relative, дедуп, кеп) — щоб у trace не текли абсолютні шляхи машини.
  const touchedAbs = []
  let closed = false
  try {
    closed = await fixConcernCore(item, initialViolations, deps, chain, chainExtra, touchedAbs)
    return closed
  } finally {
    const base = realpathBestEffort(deps.cwd)
    const rel = [...new Set(touchedAbs.map(p => relative(base, realpathBestEffort(p))))]
    chainExtra.touchedTotal = rel.length
    chainExtra.touchedFiles = rel.slice(0, TOUCHED_FILES_CAP)
    let outcome = 'fail'
    if (closed) outcome = 'success'
    else if (chainExtra.stop) outcome = 'partial'
    chain.end({ outcome, extra: chainExtra })
  }
}

/**
 * Фіксує результат T0-фази в телеметрії ланцюжка: застосовані патерни, їхні
 * зміни (permanent — рахуються навіть якщо concern далі не закрився) і
 * resolvedBy='t0' при закритті.
 * @param {{ closed: boolean, applied: Array<{ id: string, message: string|null, touchedFiles: string[] }> }} t0 Результат runT0Phase.
 * @param {{ t0Closed: boolean, resolvedBy: string|null, t0Applied: object[] }} chainExtra Акумулятор extra.
 * @param {string[]} touchedAbs Акумулятор абсолютних шляхів змін.
 * @returns {void}
 */
function noteT0Phase(t0, chainExtra, touchedAbs) {
  if (t0.applied.length > 0) {
    chainExtra.t0Applied = t0.applied.map(a => ({ id: a.id, message: a.message }))
    touchedAbs.push(...t0.applied.flatMap(a => a.touchedFiles))
  }
  if (t0.closed) {
    chainExtra.t0Closed = true
    chainExtra.resolvedBy = 't0'
  }
}

/**
 * Тіло fix-pipeline одного concern-а (T0 → S1 → ladder); chain/chainExtra — акумулятори
 * телеметрії ланцюжка (володіє ними fixConcern-обгортка).
 * @param {PlanItem} item Елемент плану.
 * @param {LintViolation[]} initialViolations Початкові порушення.
 * @param {object} deps Залежності pipeline (див. fixConcern).
 * @param {object} chain Chain handle.
 * @param {{ t0Closed: boolean, stop: string|null, rungs: object[], rollbacks: number, avgCapSkipped: number, problem: object|null, resolvedBy: string|null, t0Applied: object[] }} chainExtra Акумулятор extra.
 * @param {string[]} touchedAbs Акумулятор абсолютних шляхів реально збережених змін (T0 + closing rung).
 * @returns {Promise<boolean>} Чи закрито concern.
 */
async function fixConcernCore(item, initialViolations, deps, chain, chainExtra, touchedAbs) {
  const { cwd, ladder, log, progress = null, verbose = false } = deps
  const { ruleId } = item.entry
  const concernName = item.entry.concern.name
  const concernDir = item.entry.concern.dir
  /** @type {LintContext} */
  const lintCtx = { cwd, ruleId, concernId: concernName, concernDir, files: item.files, verbose }

  // ── T0 (детермінований, permanent) ──
  const patterns = deps.t0Override ?? (await loadT0Patterns(concernDir, concernName))
  const t0 = await runT0Phase(item, initialViolations, patterns, lintCtx, cwd, log, progress, verbose)
  noteT0Phase(t0, chainExtra, touchedAbs)
  if (t0.closed) return true
  initialViolations = t0.violations
  // Standalone-концерни стартують без початкового detect (problem=null) — перший
  // canonical detect відбувається тут, після T0; фіксуємо його як проблему ланцюжка.
  if (!chainExtra.problem) chainExtra.problem = summarizeProblem(initialViolations)

  // ── Fixability-гейт ── config/structural concern-и НЕ йдуть у LLM-ladder: їхній фікс
  // детермінований (T0/regen) або ризикований для авто-правки. T0 уже відпрацював вище —
  // якщо не закрив, це сигнал ручного/config-фіксу, а не привід палити tier-и (fail-fast).
  const fixability = item.entry.concern.fixability ?? 'code'
  if (fixability !== 'code') {
    log(`  ⏹️  ${ruleId}/${concernName}: fixability=${fixability} — LLM-ladder пропущено (T0/manual)\n`)
    chainExtra.stop = 'fixability'
    return false
  }

  // ── Worker ladder ── concern-specific fix-worker.mjs, інакше дефолтний pi-agent worker.
  const worker = await resolveWorker(concernDir, deps.workerOverride)
  if (!worker || ladder.length === 0) {
    chainExtra.stop = 'no-worker'
    return false
  }

  // S1: знімок post-T0. Один tracker акумулює pre-images; rollback цілить у S1.
  const snapshot = createSnapshot()
  let feedback = null
  let violations = initialViolations
  const skipModels = new Set()

  for (const rung of ladder) {
    if (skipModels.has(rung.model)) continue
    if (rung.isAvg && deps.avgRemaining() <= 0) {
      log(`  ⏭️  ${ruleId}/${concernName}: ${rung.tier} пропущено (avg-кеп вичерпано)\n`)
      chainExtra.avgCapSkipped++
      continue
    }

    const res = await runRung(rung, worker, violations, feedback, {
      item,
      cwd,
      snapshot,
      log,
      progress,
      verbose,
      chain
    })
    if (rung.isAvg) deps.spendAvg(1)
    chainExtra.rungs.push({
      tier: rung.tier,
      model: rung.model,
      error: res.closed ? null : (res.outcome.feedback.previousError ?? '').slice(0, 200)
    })
    if (res.closed) {
      chainExtra.resolvedBy = `${rung.tier}:${rung.model}`
      touchedAbs.push(...res.touchedFiles)
      return true
    }
    chainExtra.rollbacks++

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
 * @param {import('./progress.mjs').ProgressReporter|null} [progress] Reporter прогресу.
 * @returns {Promise<{ code: 2 } | { detected: Array<{ item: PlanItem, violations: LintViolation[] }> }>} код 2 при DetectorError або зібрані результати detect.
 */
async function detectAllForFix(plan, cwd, verbose, log, progress = null) {
  /** @type {Array<{ item: PlanItem, violations: LintViolation[] }>} */
  const detected = []
  for (const item of plan) {
    const ctx = { cwd, ruleId: item.entry.ruleId, concernId: item.entry.concern.name, files: item.files, verbose }
    progress?.concernStart(progressKey(item), 'detect')
    if (verbose) {
      const countStr = item.files === undefined ? 'весь репо' : `${item.files.length} файл(ів)`
      log(`  🔍 ${ctx.ruleId}/${ctx.concernId}  [${item.entry.concern.lint.scope}]  → ${countStr}\n`)
    }
    try {
      const res = await runConcernDetector(item.entry.concern, ctx)
      progress?.detectSnapshot(progressKey(item), res.violations.length)
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
 * @param {boolean} [verbose] Детальний вивід (прокидається у ctx concern-а).
 * @returns {Promise<void>} нічого не повертає (тільки лог).
 */
async function renderRemaining(failing, cwd, log, verbose = false) {
  const remaining = []
  for (const { item } of failing) {
    try {
      remaining.push(...(await reDetect(item, cwd, null, verbose)))
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
 * @param {boolean} [opts.isTTY] Override TTY-режиму ProgressReporter (тести); типово isTTY stdout.
 * @param {(snap: object) => void} [opts.onProgress] Публікація знімків прогресу назовні (черга lint --full).
 * @param {object} [opts.deps] Інжекти для тестів: { ladder, workerFor, t0For, chainFactory }.
 * @returns {Promise<0|1|2>} Exit code: 0 — чисто, 1 — лишились порушення, 2 — DetectorError.
 */
export async function runFixPipeline(opts) {
  const { cwd } = opts
  const baseLog = opts.log ?? (s => process.stdout.write(s))
  const verbose = opts.verbose === true
  const deps = opts.deps ?? {}

  const plan = await buildDetectPlan(opts)

  // ProgressReporter (канон scripts.mdc «Прогрес довгих lint/fix-прогонів»):
  // бар по концернах + тикер порушень; TTY/не-TTY розгалуження всередині.
  // onUpdate → publisher черги (--full): процеси в черзі бачать живий прогрес.
  const progress = createProgressReporter({
    total: plan.length,
    log: baseLog,
    isTTY: opts.isTTY,
    onUpdate: opts.onProgress
  })
  const log = progress.log

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

  // try/finally: stop() гарантовано звільняє TTY-рядок (hideCursor) навіть при
  // DetectorError з глибини fix-циклу; сам stop() ідемпотентний.
  try {
    // ── Detect лише для normal-концернів; standalone апляє одразу (без початкового detect) ──
    const detectResult = await detectAllForFix(normalPlan, cwd, verbose, log, progress)
    if ('code' in detectResult) return detectResult.code

    const failing = detectResult.detected.filter(d => d.violations.length > 0)
    // Чисті концерни закриваються одразу — бар рухається без очікування fix-фази.
    for (const d of detectResult.detected) {
      if (d.violations.length === 0) progress.concernDone(progressKey(d.item))
    }
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
        progress,
        verbose,
        avgRemaining: () => avgBudget,
        spendAvg: n => {
          avgBudget -= n
        },
        workerOverride: deps.workerFor ? deps.workerFor(item.entry) : undefined,
        t0Override: patternsByItem.get(item),
        chainFactory: deps.chainFactory
      })

    let worst = 0
    const attemptedForRender = []

    for (const { item, violations } of failing) {
      if (!(await runOne(item, violations))) {
        worst = 1
        attemptedForRender.push({ item })
      }
      progress.concernDone(progressKey(item))
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
      progress.concernDone(progressKey(item))
    }

    // Бар звільняє TTY-рядок ДО фінального render-у невирішених порушень.
    progress.stop()
    if (worst === 1) await renderRemaining(attemptedForRender, cwd, baseLog, verbose)

    return worst
  } finally {
    progress.stop()
  }
}
