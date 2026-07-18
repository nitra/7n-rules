/**
 * Detect-only оркестратор unified lint surface (`n-rules lint --no-fix`).
 *
 * Discovery → scope-selection → `lint(ctx)` per concern → нормалізовані violations.
 * Без мутацій, без LLM. Fix-pipeline (T0 + ladder) обгортає цей модуль і споживає
 * його violations; сам detect ніколи не пише в дерево.
 * @typedef {import('./types.mjs').LintContext} LintContext
 * @typedef {import('./types.mjs').LintViolation} LintViolation
 * @typedef {import('../concern-meta.mjs').ConcernMeta} ConcernMeta
 * @typedef {{ ruleId: string, concern: ConcernMeta }} LintEntry
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import picomatch from 'picomatch'

import { listConcerns } from '../concern-meta.mjs'
import { collectChangedFilesSince, resolveChangedBase } from '../changed-files.mjs'
import { readNRulesConfigLite, isRuleEnabled, isConcernEnabled } from '../read-n-rules-config-lite.mjs'
import { getActiveCapabilities, resolvePlugins } from '../resolve-plugins.mjs'
import { runConcernDetector, DetectorError } from './detect.mjs'
import { renderViolations, renderDiagnostics } from './render.mjs'
import { createProgressReporter } from './progress.mjs'

// Цей файл: npm/scripts/lib/lint-surface/run-detectors.mjs → PACKAGE_ROOT = npm (4 dirname угору).
export const DEFAULT_RULES_DIR = join(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))), 'rules')

/**
 * Похідна lint-поверхня для policy-concern-а (коли немає явного `lint` блоку).
 * scope=full; glob із policy.files — щоб delta-режим тригерив concern на зміні таргета.
 * @param {import('../concern-meta.mjs').PolicySurface} policy policy-поверхня concern-а.
 * @returns {import('../concern-meta.mjs').LintSurface} похідна lint-поверхня (scope=full).
 */
function deriveLintFromPolicy(policy) {
  const f = policy.files ?? {}
  /** @type {string[]} */
  let glob = []
  if (typeof f.single === 'string') glob = [f.single]
  else if (Array.isArray(f.walkGlob)) glob = f.walkGlob
  else if (typeof f.walkGlob === 'string') glob = [f.walkGlob]
  return { scope: 'full', glob }
}

/**
 * Concern → виконуваний detector-entry. Concern із явним `lint` бере його;
 * policy-concern без `lint` отримує похідну поверхню (детектор = generated main.mjs).
 * @param {ConcernMeta} c вхідний concern.
 * @returns {ConcernMeta|null} концерн із гарантованим `lint`, або null якщо не виконуваний
 */
function asDetectorConcern(c) {
  if (c.lint !== undefined) return c
  // policy-concern → standalone detector лише якщо files резолвиться (single/walkGlob);
  // без цього concern — rego-бібліотека для parent-orchestrator-а, не самостійний detector.
  if (c.policy !== undefined) {
    const f = c.policy.files
    const resolvable = f && typeof f === 'object' && (typeof f.single === 'string' || f.walkGlob !== undefined)
    if (resolvable) return { ...c, lint: deriveLintFromPolicy(c.policy) }
  }
  return null
}

/**
 * Скан усіх concern-ів-detector-ів у `rulesDir` (із lint-поверхнею або policy).
 * @param {string} rulesDir корінь із правилами.
 * @returns {Promise<Record<string, ConcernMeta[]>>} concerns згруповані за rule-id.
 */
async function readLintConcernsByRule(rulesDir) {
  const { readdir } = await import('node:fs/promises')
  const { join } = await import('node:path')
  /** @type {Record<string, ConcernMeta[]>} */
  const out = {}
  let entries
  try {
    entries = await readdir(rulesDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const listed = await listConcerns(join(rulesDir, e.name))
    const concerns = listed.map(c => asDetectorConcern(c)).filter(Boolean)
    if (concerns.length > 0) out[e.name] = /** @type {ConcernMeta[]} */ (concerns)
  }
  return out
}

/**
 * Rules-каталоги прогону: явний `opts.rulesDirs`, або базовий (`opts.rulesDir` ?? вбудований)
 * плюс каталоги плагінів з `.n-rules.json` (hot-path: без install і без warning-шуму).
 * @param {{ rulesDirs?: string[], rulesDir?: string, cwd: string }} opts опції прогону.
 * @returns {Promise<string[]>} упорядковані rules-каталоги (ядро перше).
 */
async function effectiveRulesDirs(opts) {
  if (Array.isArray(opts.rulesDirs) && opts.rulesDirs.length > 0) return opts.rulesDirs
  const base = opts.rulesDir ?? DEFAULT_RULES_DIR
  const config = await readNRulesConfigLite(opts.cwd)
  const plugins = resolvePlugins(opts.cwd, { plugins: config.plugins }, { allowInstall: false, quiet: true })
  return [base, ...plugins.map(p => p.rulesDir)]
}

/**
 * Відкидає концерни з незадоволеним `requires.capability`: capability надають
 * встановлені плагіни (маніфест `n-rules.capabilities`). Явний `opts.capabilities`
 * (тести) перекриває резолв.
 * @param {Record<string, ConcernMeta[]>} byRule concerns за rule-id.
 * @param {{ capabilities?: Iterable<string>, cwd: string }} opts опції прогону.
 * @returns {Promise<Record<string, ConcernMeta[]>>} відфільтровані concerns.
 */
async function filterByCapabilities(byRule, opts) {
  let caps
  if (opts.capabilities) {
    caps = new Set(opts.capabilities)
  } else {
    const config = await readNRulesConfigLite(opts.cwd)
    caps = getActiveCapabilities(opts.cwd, { plugins: config.plugins }, { allowInstall: false, quiet: true })
  }
  /** @type {Record<string, ConcernMeta[]>} */
  const out = {}
  for (const [ruleId, concerns] of Object.entries(byRule)) {
    const kept = concerns.filter(c => c.requiresCapability === undefined || caps.has(c.requiresCapability))
    if (kept.length > 0) out[ruleId] = kept
  }
  return out
}

/**
 * Валідує `rule/concern`-записи з `disable-rules`: concern має існувати серед
 * `byRule[ruleId]`. Невідомий id — гучна помилка (не тихий no-op), з "did you mean"
 * на найближчий за префіксом concern того ж rule.
 * @param {string[]} disableRules сирий список `disable-rules` з конфігу.
 * @param {Record<string, ConcernMeta[]>} byRule відомі concerns згруповані за rule-id.
 * @returns {void}
 * @throws {Error} якщо запис виду `rule/concern` вказує на неіснуючий concern.
 */
function validatePartialDisableIds(disableRules, byRule) {
  for (const entry of disableRules) {
    const slash = entry.indexOf('/')
    if (slash === -1) continue
    const ruleId = entry.slice(0, slash)
    const concernId = entry.slice(slash + 1)
    const known = byRule[ruleId]
    if (!known) continue // невідомий rule id — не турбота цієї валідації
    const names = known.map(c => c.name)
    if (names.includes(concernId)) continue
    const suggestion = names.find(n => n.startsWith(concernId) || concernId.startsWith(n))
    throw new Error(
      `disable-rules: невідомий concern "${entry}" — доступні concern-и ${ruleId}: ${names.join(', ')}` +
        (suggestion ? ` (мали на увазі "${ruleId}/${suggestion}"?)` : '')
    )
  }
}

/**
 * Відкидає concern-и, вимкнені частково через `disable-rules` (`rule/concern`).
 * Rule-level вимикання (`ruleId` без суфікса) тут не фільтрується — його вже
 * прибирає `enabledRuleIds`/`isRuleEnabled` вище за планом; тут — лише concern-рівень.
 * @param {Record<string, ConcernMeta[]>} byRule concerns за rule-id (уже після filterByCapabilities).
 * @param {{ cwd: string }} opts опції прогону.
 * @returns {Promise<Record<string, ConcernMeta[]>>} відфільтровані concerns.
 */
async function filterByDisabledConcerns(byRule, opts) {
  const config = await readNRulesConfigLite(opts.cwd)
  if (!config.exists) return byRule
  validatePartialDisableIds(config.disableRules, byRule)
  /** @type {Record<string, ConcernMeta[]>} */
  const out = {}
  for (const [ruleId, concerns] of Object.entries(byRule)) {
    const kept = concerns.filter(c => isConcernEnabled(config, ruleId, c.name))
    if (kept.length > 0) out[ruleId] = kept
  }
  return out
}

/**
 * Мердж concerns кількох rules-каталогів: правила зливаються за id, концерни — за іменем
 * (перший власник виграє: ядро → плагіни у порядку списку). Плагін може ДОДАВАТИ концерни
 * до правила ядра (mixin), але не перекривати наявні.
 * @param {string[]} rulesDirs упорядковані rules-каталоги.
 * @returns {Promise<Record<string, ConcernMeta[]>>} об'єднані concerns за rule-id.
 */
async function readLintConcernsByRuleMulti(rulesDirs) {
  /** @type {Record<string, ConcernMeta[]>} */
  const merged = {}
  for (const dir of rulesDirs) {
    const byRule = await readLintConcernsByRule(dir)
    for (const [ruleId, concerns] of Object.entries(byRule)) {
      if (!(ruleId in merged)) {
        merged[ruleId] = [...concerns]
        continue
      }
      const seen = new Set(merged[ruleId].map(c => c.name))
      for (const c of concerns) {
        if (!seen.has(c.name)) merged[ruleId].push(c)
      }
    }
  }
  return merged
}

/**
 * Активні rule-id з `.n-rules.json` (для delta/full режимів).
 * @param {Record<string, ConcernMeta[]>} byRule concerns згруповані за rule-id.
 * @param {string} cwd робоча директорія прогону.
 * @returns {Promise<string[]>} перелік активних rule-id.
 */
async function enabledRuleIds(byRule, cwd) {
  const config = await readNRulesConfigLite(cwd)
  if (!config.exists) return []
  return Object.keys(byRule).filter(id => isRuleEnabled(config, id))
}

/**
 * @param {LintEntry[]} entries вхідні lint-entries.
 * @returns {LintEntry[]} стабільний алфавітний порядок
 */
function sortEntries(entries) {
  return entries.toSorted((a, b) => a.ruleId.localeCompare(b.ruleId) || a.concern.name.localeCompare(b.concern.name))
}

/**
 * @typedef {{ entry: LintEntry, files: string[]|undefined }} PlanItem
 */

/**
 * Будує план прогону для заданих опцій (discovery + scope-table).
 * Спільне джерело для detect-only і fix-pipeline.
 * @param {object} opts опції прогону.
 * @param {string} [opts.rulesDir] базовий корінь із правилами (дефолт — вбудований).
 * @param {string[]} [opts.rulesDirs] явні rules-каталоги (ядро + плагіни); без них — базовий + плагіни з конфігу.
 * @param {string} opts.cwd робоча директорія прогону.
 * @param {boolean} [opts.full] whole-repo режим (усі enabled-concerns).
 * @param {string[]} [opts.rules] scoped rule-id (порожній → delta/full).
 * @param {string[]|null} [opts.files] явний перелік файлів або null.
 * @returns {Promise<PlanItem[]>} впорядкований план прогону.
 */
export async function buildDetectPlan(opts) {
  const byRule = await filterByDisabledConcerns(
    await filterByCapabilities(await readLintConcernsByRuleMulti(await effectiveRulesDirs(opts)), opts),
    opts
  )
  return buildPlan({
    byRule,
    full: opts.full === true,
    rules: Array.isArray(opts.rules) ? opts.rules : [],
    explicitFiles: Array.isArray(opts.files) ? opts.files : null,
    cwd: opts.cwd
  })
}

/**
 * scoped-режим: усі lint-concerns названих правил, whole-repo.
 * @param {Record<string, ConcernMeta[]>} byRule concerns згруповані за rule-id.
 * @param {string[]} rules scoped rule-id.
 * @returns {PlanItem[]} впорядкований план (за ruleId).
 */
function buildScopedPlan(byRule, rules) {
  const plan = []
  for (const ruleId of rules) {
    for (const concern of byRule[ruleId] ?? []) plan.push({ entry: { ruleId, concern }, files: undefined })
  }
  return plan.toSorted((a, b) => a.entry.ruleId.localeCompare(b.entry.ruleId))
}

/**
 * full-режим: усі per-file + full concerns enabled-правил, whole-repo.
 * @param {Record<string, ConcernMeta[]>} byRule concerns згруповані за rule-id.
 * @param {Set<string>} enabledSet активні rule-id.
 * @returns {PlanItem[]} впорядкований план (whole-repo для кожного entry).
 */
function buildFullPlan(byRule, enabledSet) {
  /** @type {LintEntry[]} */
  const entries = []
  for (const [ruleId, concerns] of Object.entries(byRule)) {
    if (!enabledSet.has(ruleId)) continue
    for (const concern of concerns) entries.push({ ruleId, concern })
  }
  return sortEntries(entries).map(entry => ({ entry, files: undefined }))
}

/**
 * Планує один concern у delta/explicit-files режимі за його lint.scope.
 * @param {string} ruleId rule-id concern-а.
 * @param {ConcernMeta} concern concern із lint-поверхнею.
 * @param {string[]} changed перелік змінених файлів.
 * @returns {PlanItem|null} plan-item concern-а або null, якщо concern не тригериться.
 */
function planConcernForDelta(ruleId, concern, changed) {
  const { scope, glob } = concern.lint
  const isMatch = glob.length > 0 ? picomatch(glob, { dot: true }) : () => false
  if (scope === 'per-file') {
    const files = glob.length > 0 ? changed.filter(f => isMatch(f)) : changed
    return files.length > 0 ? { entry: { ruleId, concern }, files } : null
  }
  // full: запускається whole-repo лише якщо glob ∩ changed ≠ ∅
  if (glob.length > 0 && changed.some(f => isMatch(f))) {
    return { entry: { ruleId, concern }, files: undefined }
  }
  return null
}

/**
 * delta/explicit-files режим: concern-и enabled-правил, зіставлені зі зміненими файлами.
 * @param {Record<string, ConcernMeta[]>} byRule concerns згруповані за rule-id.
 * @param {Set<string>} enabledSet активні rule-id.
 * @param {string[]} changed перелік змінених файлів.
 * @returns {PlanItem[]} впорядкований план (за ruleId, потім concern.name).
 */
function buildDeltaPlan(byRule, enabledSet, changed) {
  /** @type {PlanItem[]} */
  const plan = []
  for (const [ruleId, concerns] of Object.entries(byRule)) {
    if (!enabledSet.has(ruleId)) continue
    for (const concern of concerns) {
      const item = planConcernForDelta(ruleId, concern, changed)
      if (item) plan.push(item)
    }
  }
  return plan.toSorted(
    (a, b) => a.entry.ruleId.localeCompare(b.entry.ruleId) || a.entry.concern.name.localeCompare(b.entry.concern.name)
  )
}

/**
 * Будує план: список entries + чи кожен запускається whole-repo (files=undefined)
 * чи per-file (files=[...]). Реалізує таблицю lint.scope зі специфікації.
 * @param {object} args аргументи побудови плану.
 * @param {Record<string, ConcernMeta[]>} args.byRule concerns згруповані за rule-id.
 * @param {boolean} args.full whole-repo режим.
 * @param {string[]} args.rules scoped rule-id (порожній → delta/full).
 * @param {string[]|null} args.explicitFiles явний перелік файлів або null.
 * @param {string} args.cwd робоча директорія прогону.
 * @returns {Promise<PlanItem[]>} впорядкований план прогону.
 */
async function buildPlan({ byRule, full, rules, explicitFiles, cwd }) {
  // scoped: усі lint-concerns названих правил, whole-repo
  if (rules.length > 0) return buildScopedPlan(byRule, rules)

  const enabled = await enabledRuleIds(byRule, cwd)
  const enabledSet = new Set(enabled)

  // full: усі per-file + full concerns enabled-правил, whole-repo
  if (full && explicitFiles === null) return buildFullPlan(byRule, enabledSet)

  // delta / explicit-files
  const changed = explicitFiles ?? (await collectChangedFilesSince(await resolveChangedBase(cwd), cwd))
  return buildDeltaPlan(byRule, enabledSet, changed)
}

/**
 * Запускає detect-only прохід. Повертає всі violations і похідний exitCode.
 * @param {object} opts опції прогону.
 * @param {string} [opts.rulesDir] базовий корінь із правилами (дефолт — вбудований).
 * @param {string[]} [opts.rulesDirs] явні rules-каталоги (ядро + плагіни); без них — базовий + плагіни з конфігу.
 * @param {string} opts.cwd робоча директорія прогону.
 * @param {boolean} [opts.full] whole-repo режим.
 * @param {string[]} [opts.rules] scoped rule-id (порожній → delta/full).
 * @param {string[]|null} [opts.files] явний перелік файлів або null.
 * @param {boolean} [opts.verbose] докладний лог прогону.
 * @param {(s: string) => void} [opts.log] функція логування.
 * @param {boolean} [opts.isTTY] override TTY-режиму ProgressReporter (тести); типово isTTY stdout.
 * @param {(snap: object) => void} [opts.onProgress] публікація знімків прогресу назовні (черга lint --full).
 * @returns {Promise<{ violations: LintViolation[], exitCode: 0|1|2, ran: LintEntry[] }>} violations, exitCode і виконані entries.
 */
export async function detectAll(opts) {
  const { cwd } = opts
  const full = opts.full === true
  const rules = Array.isArray(opts.rules) ? opts.rules : []
  const explicitFiles = Array.isArray(opts.files) ? opts.files : null
  const verbose = opts.verbose === true
  const baseLog = opts.log ?? (s => process.stdout.write(s))

  const byRule = await filterByDisabledConcerns(
    await filterByCapabilities(await readLintConcernsByRuleMulti(await effectiveRulesDirs(opts)), opts),
    opts
  )
  const plan = await buildPlan({ byRule, full, rules, explicitFiles, cwd })

  // Detect-only бар — ЛИШЕ в TTY (без тикера «виправлено»). У не-TTY (hooks, CI-gate,
  // пайпи) append-рядки ⏱ на кожен концерн засмітили б вивід кожного PostToolUse-хука,
  // тож там reporter створюється лише за наявності onProgress і «мовчазним»
  // (appendInNonTTY: false) — publisher черги (--full) отримує знімки без шуму.
  const isTTY = opts.isTTY ?? process.stdout.isTTY === true
  const progress =
    isTTY || opts.onProgress
      ? createProgressReporter({
          total: plan.length,
          log: baseLog,
          isTTY,
          withFixed: false,
          onUpdate: opts.onProgress,
          appendInNonTTY: false
        })
      : null
  const log = progress ? progress.log : baseLog

  /** @type {LintViolation[]} */
  const allViolations = []
  /** @type {LintEntry[]} */
  const ran = []

  try {
    for (const { entry, files } of plan) {
      /** @type {LintContext} */
      const ctx = { cwd, ruleId: entry.ruleId, concernId: entry.concern.name, files, verbose }
      const key = `${entry.ruleId}/${entry.concern.name}`
      progress?.concernStart(key)
      if (verbose) {
        const countStr = files === undefined ? 'весь репо' : `${files.length} файл(ів)`
        log(`  🔍 ${key}  [${entry.concern.lint.scope}]  → ${countStr}\n`)
      }
      let result
      try {
        result = await runConcernDetector(entry.concern, ctx)
      } catch (error) {
        if (error instanceof DetectorError) {
          log(`💥 ${error.message}\n`)
          return { violations: allViolations, exitCode: 2, ran }
        }
        throw error
      }
      ran.push(entry)
      allViolations.push(...result.violations)
      progress?.detectSnapshot(key, result.violations.length)
      progress?.concernDone(key)
      if (verbose && result.diagnostics && result.diagnostics.length > 0) {
        log(renderDiagnostics(result.diagnostics))
      }
    }
  } finally {
    progress?.stop()
  }

  if (allViolations.length > 0) baseLog(renderViolations(allViolations))
  return { violations: allViolations, exitCode: allViolations.length > 0 ? 1 : 0, ran }
}
