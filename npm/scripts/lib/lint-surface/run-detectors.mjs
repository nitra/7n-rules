/**
 * Detect-only оркестратор unified lint surface (`n-cursor lint --no-fix`).
 *
 * Discovery → scope-selection → `lint(ctx)` per concern → нормалізовані violations.
 * Без мутацій, без LLM. Fix-pipeline (T0 + ladder) обгортає цей модуль і споживає
 * його violations; сам detect ніколи не пише в дерево.
 *
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
import { readNCursorConfigLite, isRuleEnabled } from '../read-n-cursor-config-lite.mjs'
import { runConcernDetector, DetectorError } from './detect.mjs'

// Цей файл: npm/scripts/lib/lint-surface/run-detectors.mjs → PACKAGE_ROOT = npm (4 dirname угору).
export const DEFAULT_RULES_DIR = join(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))), 'rules')
import { renderViolations, renderDiagnostics } from './render.mjs'

/**
 * Похідна lint-поверхня для policy-concern-а (коли немає явного `lint` блоку).
 * scope=full; glob із policy.files — щоб delta-режим тригерив concern на зміні таргета.
 * @param {import('../concern-meta.mjs').PolicySurface} policy
 * @returns {import('../concern-meta.mjs').LintSurface}
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
 * @param {ConcernMeta} c
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
 * @param {string} rulesDir
 * @returns {Promise<Record<string, ConcernMeta[]>>}
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
    const concerns = (await listConcerns(join(rulesDir, e.name))).map(asDetectorConcern).filter(Boolean)
    if (concerns.length > 0) out[e.name] = /** @type {ConcernMeta[]} */ (concerns)
  }
  return out
}

/**
 * Активні rule-id з `.n-cursor.json` (для delta/full режимів).
 * @param {Record<string, ConcernMeta[]>} byRule
 * @param {string} cwd
 * @returns {Promise<string[]>}
 */
async function enabledRuleIds(byRule, cwd) {
  const config = await readNCursorConfigLite(cwd)
  if (!config.exists) return []
  return Object.keys(byRule).filter(id => isRuleEnabled(config, id))
}

/**
 * @param {LintEntry[]} entries
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
 * @param {object} opts
 * @param {string} opts.rulesDir
 * @param {string} opts.cwd
 * @param {boolean} [opts.full]
 * @param {string[]} [opts.rules]
 * @param {string[]|null} [opts.files]
 * @returns {Promise<PlanItem[]>}
 */
export async function buildDetectPlan(opts) {
  const byRule = await readLintConcernsByRule(opts.rulesDir ?? DEFAULT_RULES_DIR)
  return buildPlan({
    byRule,
    full: opts.full === true,
    rules: Array.isArray(opts.rules) ? opts.rules : [],
    explicitFiles: Array.isArray(opts.files) ? opts.files : null,
    cwd: opts.cwd
  })
}

/**
 * Будує план: список entries + чи кожен запускається whole-repo (files=undefined)
 * чи per-file (files=[...]). Реалізує таблицю lint.scope зі специфікації.
 * @param {object} args
 * @param {Record<string, ConcernMeta[]>} args.byRule
 * @param {boolean} args.full
 * @param {string[]} args.rules scoped rule-id (порожній → delta/full)
 * @param {string[]|null} args.explicitFiles
 * @param {string} args.cwd
 * @returns {Promise<PlanItem[]>}
 */
async function buildPlan({ byRule, full, rules, explicitFiles, cwd }) {
  // scoped: усі lint-concerns названих правил, whole-repo
  if (rules.length > 0) {
    const plan = []
    for (const ruleId of rules) {
      for (const concern of byRule[ruleId] ?? []) plan.push({ entry: { ruleId, concern }, files: undefined })
    }
    return plan.map(p => p).sort((a, b) => a.entry.ruleId.localeCompare(b.entry.ruleId))
  }

  const enabled = await enabledRuleIds(byRule, cwd)
  const enabledSet = new Set(enabled)

  // full: усі per-file + full concerns enabled-правил, whole-repo
  if (full && explicitFiles === null) {
    /** @type {LintEntry[]} */
    const entries = []
    for (const [ruleId, concerns] of Object.entries(byRule)) {
      if (!enabledSet.has(ruleId)) continue
      for (const concern of concerns) entries.push({ ruleId, concern })
    }
    return sortEntries(entries).map(entry => ({ entry, files: undefined }))
  }

  // delta / explicit-files
  const changed = explicitFiles ?? (await collectChangedFilesSince(await resolveChangedBase(cwd), cwd))

  /** @type {Array<{ entry: LintEntry, files: string[]|undefined }>} */
  const plan = []
  for (const [ruleId, concerns] of Object.entries(byRule)) {
    if (!enabledSet.has(ruleId)) continue
    for (const concern of concerns) {
      const { scope, glob } = concern.lint
      const isMatch = glob.length > 0 ? picomatch(glob, { dot: true }) : () => false
      if (scope === 'per-file') {
        const files = glob.length > 0 ? changed.filter(f => isMatch(f)) : changed
        if (files.length > 0) plan.push({ entry: { ruleId, concern }, files })
      } else if (glob.length > 0 && changed.some(f => isMatch(f))) {
        // full: запускається whole-repo лише якщо glob ∩ changed ≠ ∅
        plan.push({ entry: { ruleId, concern }, files: undefined })
      }
    }
  }
  return plan.toSorted(
    (a, b) => a.entry.ruleId.localeCompare(b.entry.ruleId) || a.entry.concern.name.localeCompare(b.entry.concern.name)
  )
}

/**
 * Запускає detect-only прохід. Повертає всі violations і похідний exitCode.
 * @param {object} opts
 * @param {string} opts.rulesDir
 * @param {string} opts.cwd
 * @param {boolean} [opts.full]
 * @param {string[]} [opts.rules]
 * @param {string[]|null} [opts.files]
 * @param {boolean} [opts.verbose]
 * @param {(s: string) => void} [opts.log]
 * @returns {Promise<{ violations: LintViolation[], exitCode: 0|1|2, ran: LintEntry[] }>}
 */
export async function detectAll(opts) {
  const rulesDir = opts.rulesDir ?? DEFAULT_RULES_DIR
  const { cwd } = opts
  const full = opts.full === true
  const rules = Array.isArray(opts.rules) ? opts.rules : []
  const explicitFiles = Array.isArray(opts.files) ? opts.files : null
  const verbose = opts.verbose === true
  const log = opts.log ?? (s => process.stdout.write(s))

  const byRule = await readLintConcernsByRule(rulesDir)
  const plan = await buildPlan({ byRule, full, rules, explicitFiles, cwd })

  /** @type {LintViolation[]} */
  const allViolations = []
  /** @type {LintEntry[]} */
  const ran = []

  for (const { entry, files } of plan) {
    /** @type {LintContext} */
    const ctx = { cwd, ruleId: entry.ruleId, concernId: entry.concern.name, files }
    if (verbose) {
      const countStr = files === undefined ? 'весь репо' : `${files.length} файл(ів)`
      log(`  🔍 ${entry.ruleId}/${entry.concern.name}  [${entry.concern.lint.scope}]  → ${countStr}\n`)
    }
    let result
    try {
      result = await runConcernDetector(entry.concern, ctx)
    } catch (err) {
      if (err instanceof DetectorError) {
        log(`💥 ${err.message}\n`)
        return { violations: allViolations, exitCode: 2, ran }
      }
      throw err
    }
    ran.push(entry)
    allViolations.push(...result.violations)
    if (verbose && result.diagnostics && result.diagnostics.length > 0) {
      log(renderDiagnostics(result.diagnostics))
    }
  }

  if (allViolations.length > 0) log(renderViolations(allViolations))
  return { violations: allViolations, exitCode: allViolations.length > 0 ? 1 : 0, ran }
}
