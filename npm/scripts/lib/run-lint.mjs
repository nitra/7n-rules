/** @see ./docs/run-lint.md */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cwd as processCwd } from 'node:process'
import { spawnSync } from 'node:child_process'

import picomatch from 'picomatch'

import { listConcerns } from './concern-meta.mjs'
import { collectChangedFilesSince, resolveChangedBase } from './changed-files.mjs'
import { resolveCmd } from '../utils/resolve-cmd.mjs'
import { isRuleEnabled, readNCursorConfigLite } from './read-n-cursor-config-lite.mjs'

// Цей файл: npm/scripts/lib/run-lint.mjs → PACKAGE_ROOT = npm (три dirname угору).
const PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const RULES_DIR = join(PACKAGE_ROOT, 'rules')

/**
 * @typedef {import('./concern-meta.mjs').ConcernMeta} ConcernMeta
 */

/**
 * @typedef {object} RuleLintEntry
 * @property {string} ruleId
 * @property {ConcernMeta} concern
 */

/**
 * Сканує всі lint-concerns усіх правил.
 * @param {string} rulesDir
 * @returns {Promise<Record<string, ConcernMeta[]>>} ruleId → lint concerns
 */
async function readAllLintConcerns(rulesDir) {
  /** @type {Record<string, ConcernMeta[]>} */
  const out = {}
  if (!existsSync(rulesDir)) return out
  const entries = await readdir(rulesDir, { withFileTypes: true })
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const concerns = await listConcerns(join(rulesDir, e.name))
    const lintConcerns = concerns.filter(c => c.lint !== undefined)
    if (lintConcerns.length > 0) out[e.name] = lintConcerns
  }
  return out
}

/**
 * Вибирає lint-entries для прогону (per-file і, якщо full=true, full concerns).
 * @param {Record<string, ConcernMeta[]>} lintConcernsByRule
 * @param {boolean} full
 * @param {string[]} enabledRuleIds
 * @returns {RuleLintEntry[]} алфавітно за ruleId, потім за concern name
 */
export function selectLintEntries(lintConcernsByRule, full, enabledRuleIds) {
  const enabled = new Set(enabledRuleIds)
  /** @type {RuleLintEntry[]} */
  const out = []
  for (const [ruleId, concerns] of Object.entries(lintConcernsByRule)) {
    if (!enabled.has(ruleId)) continue
    for (const concern of concerns) {
      const scope = concern.lint.scope
      if (scope === 'per-file' || (full && scope === 'full')) {
        out.push({ ruleId, concern })
      }
    }
  }
  return out.toSorted((a, b) => a.ruleId.localeCompare(b.ruleId) || a.concern.name.localeCompare(b.concern.name))
}

/**
 * Вибирає full-scope lint-entries для запуску в delta-режимі.
 * Concern включається, якщо lint.glob ∩ changed ≠ ∅.
 * @param {Record<string, ConcernMeta[]>} lintConcernsByRule
 * @param {string[]} changed
 * @param {string[]} enabledRuleIds
 * @returns {RuleLintEntry[]}
 */
function selectFullEntriesForDelta(lintConcernsByRule, changed, enabledRuleIds) {
  if (changed.length === 0) return []
  const enabled = new Set(enabledRuleIds)
  /** @type {RuleLintEntry[]} */
  const out = []
  for (const [ruleId, concerns] of Object.entries(lintConcernsByRule)) {
    if (!enabled.has(ruleId)) continue
    for (const concern of concerns) {
      if (concern.lint.scope !== 'full') continue
      const glob = concern.lint.glob
      if (glob.length === 0) continue
      const isMatch = picomatch(glob, { dot: true })
      if (changed.some(f => isMatch(f))) out.push({ ruleId, concern })
    }
  }
  return out.toSorted((a, b) => a.ruleId.localeCompare(b.ruleId) || a.concern.name.localeCompare(b.concern.name))
}

/**
 * Активні rule-id для lint-фази.
 * @param {Record<string, ConcernMeta[]>} lintConcernsByRule
 * @param {string} cwd
 * @returns {Promise<string[]>}
 */
async function readEnabledLintRuleIds(lintConcernsByRule, cwd) {
  const config = await readNCursorConfigLite(cwd)
  if (!config.exists) return []
  return Object.keys(lintConcernsByRule).filter(id => isRuleEnabled(config, id))
}

/**
 * Конформність-фаза lint.
 * @param {string} cwd
 * @param {boolean} readOnly
 * @param {(s: string) => void} log
 * @param {string[]} [filter]
 * @returns {Promise<number>}
 */
async function runConformance(cwd, readOnly, log, filter = []) {
  if (!readOnly) {
    const { runOrchestratorCli } = await import('./fix/orchestrator.mjs')
    return runOrchestratorCli(filter, cwd)
  }
  const { runConformanceCheck } = await import('./fix/run-conformance-check.mjs')
  const { rules } = await runConformanceCheck(filter, cwd)
  const failed = rules.filter(x => !x.ok)
  if (failed.length === 0) return 0
  log(`❌ lint: конформність — ${failed.length} порушень: ${failed.map(x => x.ruleId).join(', ')}\n`)
  for (const f of failed) if (f.output) log(`${f.output}\n`)
  return 1
}

/**
 * Запускає список lint-entries. Fail-fast лише у read-only.
 * @param {RuleLintEntry[]} entries
 * @param {{ changed: string[]|undefined, cwd: string, readOnly: boolean, verbose?: boolean, log: (s: string) => void }} ctx
 * @returns {Promise<{ stop: boolean, code: number }>}
 */
async function runLintEntries(entries, ctx) {
  const { changed, cwd, readOnly, verbose, log } = ctx
  let worst = 0
  for (const { ruleId, concern } of entries) {
    const lintPath = join(concern.dir, 'main.mjs')
    if (!existsSync(lintPath)) {
      log(`⚠️  lint: ${ruleId}/${concern.name} має lint surface але немає main.mjs — пропускаю.\n`)
      continue
    }
    // eslint-disable-next-line no-unsanitized/method
    const mod = await import(lintPath)
    if (typeof mod.lint !== 'function') continue
    const filteredChanged =
      changed !== undefined && concern.lint.scope === 'per-file' && concern.lint.glob.length > 0
        ? changed.filter(picomatch(concern.lint.glob, { dot: true }))
        : changed
    if (verbose) {
      const { scope, glob } = concern.lint
      const globStr = glob.length > 0 ? glob.join(', ') : '—'
      const countStr = filteredChanged === undefined ? 'весь репо' : `${filteredChanged.length} файл(ів)`
      log(`  🔍 ${ruleId}/${concern.name}  [${scope}]  glob: ${globStr}  → ${countStr}\n`)
    }
    const code = await mod.lint(filteredChanged, cwd, { readOnly, llmFix: concern.lint.llmFix })
    if (code !== 0) {
      if (readOnly) return { stop: true, code }
      worst = code
    }
  }
  return { stop: false, code: worst }
}

/**
 * Формат-крок (`oxfmt .`).
 * @param {string} cwd
 * @param {(s: string) => void} log
 * @returns {number}
 */
function runFormat(cwd, log) {
  const oxfmt = resolveCmd('oxfmt')
  if (!oxfmt) {
    log('ℹ️  lint: oxfmt недоступний у PATH — формат-крок пропущено.\n')
    return 0
  }
  const r = spawnSync(oxfmt, ['.'], { cwd, stdio: 'inherit', shell: false })
  const code = typeof r.status === 'number' ? r.status : 1
  if (code !== 0) log(`❌ lint: oxfmt — помилка (код ${code})\n`)
  return code
}

/**
 * Scoped-режим (`lint <rule…>`): повний прогін названих правил (whole-repo) + конформність.
 * @param {string[]} rules id названих правил
 * @param {{ cwd: string, readOnly: boolean, rulesDir: string, conformance: boolean, log: (s: string) => void }} ctx
 * @returns {Promise<number>}
 */
async function runScopedRules(rules, ctx) {
  const { cwd, readOnly, verbose, rulesDir, conformance, log } = ctx
  const lintConcernsByRule = await readAllLintConcerns(rulesDir)
  // Scoped: whole-repo (changed=undefined), usі lint concerns названих правил
  const entries = rules.flatMap(ruleId => (lintConcernsByRule[ruleId] ?? []).map(concern => ({ ruleId, concern })))
  let worst = 0
  if (entries.length > 0) {
    const result = await runLintEntries(entries, { changed: undefined, cwd, readOnly, verbose, log })
    if (result.stop) return result.code
    worst = result.code
  }
  if (!conformance) return worst
  const conformanceCode = await runConformance(cwd, readOnly, log, rules)
  if (conformanceCode !== 0) {
    if (readOnly) return conformanceCode
    worst = conformanceCode
  }
  return worst
}

/**
 * Запускає lint-оркестрацію.
 * @param {{ full?: boolean, readOnly?: boolean, verbose?: boolean, rules?: string[], files?: string[], cwd?: string, rulesDir?: string, log?: (s: string) => void }} [opts]
 * @returns {Promise<number>}
 */
export async function runLint(opts = {}) {
  const full = opts.full === true
  const readOnly = opts.readOnly === true
  const verbose = opts.verbose === true
  const rules = Array.isArray(opts.rules) ? opts.rules : []
  const explicitFiles = Array.isArray(opts.files) ? opts.files : null
  const cwd = opts.cwd ?? processCwd()
  const rulesDir = opts.rulesDir ?? RULES_DIR
  const log = opts.log ?? (s => process.stdout.write(s))

  if (rules.length > 0) {
    return runScopedRules(rules, { cwd, readOnly, verbose, rulesDir, conformance: opts.rulesDir === undefined, log })
  }

  if (explicitFiles !== null) {
    const lintConcernsByRule = await readAllLintConcerns(rulesDir)
    const enabledRuleIds = await readEnabledLintRuleIds(lintConcernsByRule, cwd)
    const entries = selectLintEntries(lintConcernsByRule, false, enabledRuleIds)
    const result = await runLintEntries(entries, { changed: explicitFiles, cwd, readOnly, verbose, log })
    return result.stop ? result.code : result.code
  }

  const changed = full ? undefined : collectChangedFilesSince(resolveChangedBase(cwd), cwd)
  if (!full && changed.length === 0) {
    log('\nℹ️  lint: немає змінених файлів відносно origin — нічого перевіряти.\n')
    return 0
  }

  const lintConcernsByRule = await readAllLintConcerns(rulesDir)
  const enabledRuleIds = await readEnabledLintRuleIds(lintConcernsByRule, cwd)
  const entries = selectLintEntries(lintConcernsByRule, full, enabledRuleIds)
  const result = await runLintEntries(entries, { changed, cwd, readOnly, verbose, log })
  if (result.stop) return result.code
  let worst = result.code

  if (!full && changed !== undefined && changed.length > 0) {
    const fullEntries = selectFullEntriesForDelta(lintConcernsByRule, changed, enabledRuleIds)
    if (fullEntries.length > 0) {
      const fullResult = await runLintEntries(fullEntries, { changed: undefined, cwd, readOnly, verbose, log })
      if (fullResult.stop) return fullResult.code
      if (fullResult.code !== 0) worst = fullResult.code
    }
  }

  if (full && opts.rulesDir === undefined) {
    const conformanceCode = await runConformance(cwd, readOnly, log)
    if (conformanceCode !== 0) {
      if (readOnly) return conformanceCode
      worst = conformanceCode
    }
  }

  if (!readOnly && opts.rulesDir === undefined) {
    const fmtCode = runFormat(cwd, log)
    if (fmtCode !== 0) worst = fmtCode
  }
  return worst
}
