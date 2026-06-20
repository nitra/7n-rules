/** @see ./docs/orchestrate.md */
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cwd as processCwd } from 'node:process'

import { parseRuleLintSpec, readRuleMetaRaw } from '../../../scripts/lib/rule-meta.mjs'
import { collectChangedFilesSince, resolveChangedBase } from '../../../scripts/lib/changed-files.mjs'

// Цей файл: npm/rules/lint/js/orchestrate.mjs → PACKAGE_ROOT = npm (чотири dirname угору).
const PACKAGE_ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const RULES_DIR = join(PACKAGE_ROOT, 'rules')

/**
 * Конформність-фаза lint (whole-repo: config/file/workflow conformance — те, що раніше робив `fix`).
 * Per-file декомпозиції немає, тож виконується лише у `--full`.
 *  - read-only: детект через `_fix-check` (per-rule `fix.mjs run()` = перевірка, без мутацій);
 *  - fix: convergence-движок (check → Tier0 → omlx) через orchestrator.
 * @param {string} cwd корінь
 * @param {boolean} readOnly true → лише детект (нуль мутацій)
 * @param {(s: string) => void} log логер
 * @param {string[]} [filter] фільтр правил (порожній — усі)
 * @returns {Promise<number>} 0 — чисто, 1 — порушення/помилка
 */
async function runConformance(cwd, readOnly, log, filter = []) {
  if (!readOnly) {
    const { runOrchestratorCli } = await import('../../../scripts/lib/fix/orchestrator.mjs')
    return runOrchestratorCli(filter, cwd)
  }
  const { runFixCheck } = await import('../../../scripts/lib/fix/run-fix-check.mjs')
  const { rules } = await runFixCheck(filter, cwd)
  const failed = rules.filter(x => !x.ok)
  if (failed.length === 0) return 0
  log(`❌ lint: конформність — ${failed.length} порушень: ${failed.map(x => x.ruleId).join(', ')}\n`)
  for (const f of failed) if (f.output) log(`${f.output}\n`)
  return 1
}

/**
 * Вибирає id правил для контексту, алфавітно.
 * @param {Record<string, {lint?: unknown}>} metaById мапа id → meta-обʼєкт
 * @param {boolean} full `false` → лише `per-file` правила; `true` → усі (`per-file` ∪ `full`)
 * @returns {string[]} відсортовані id
 */
export function selectLintRules(metaById, full) {
  const out = []
  for (const [id, raw] of Object.entries(metaById)) {
    const scope = parseRuleLintSpec(raw?.lint)
    if (scope === 'per-file' || (full && scope === 'full')) out.push(id)
  }
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Зчитує meta всіх правил пакета.
 * @param {string} rulesDir каталог rules
 * @returns {Record<string, Record<string, unknown>>} id → meta
 */
function readAllMeta(rulesDir) {
  /** @type {Record<string, Record<string, unknown>>} */
  const out = {}
  if (!existsSync(rulesDir)) return out
  for (const e of readdirSync(rulesDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue
    const raw = readRuleMetaRaw(join(rulesDir, e.name))
    if (raw) out[e.name] = raw
  }
  return out
}

/**
 * Per-file фаза: проганяє лінтер кожного правила. Fail-fast лише в read-only.
 * @param {string[]} ids id правил (алфавітно)
 * @param {{ rulesDir: string, changed: string[]|undefined, cwd: string, readOnly: boolean, metaById: Record<string, {llmFix?: boolean}>, log: (s: string) => void }} ctx контекст
 * @returns {Promise<{ stop: boolean, code: number }>} `stop` — read-only fail-fast; `code` — найгірший код
 */
async function runPerFileRules(ids, ctx) {
  const { rulesDir, changed, cwd, readOnly, metaById, log } = ctx
  let worst = 0
  for (const id of ids) {
    const lintPath = join(rulesDir, id, 'js', 'lint.mjs')
    if (!existsSync(lintPath)) {
      log(`⚠️  lint: правило ${id} має lint-фазу, але немає js/lint.mjs — пропускаю.\n`)
      continue
    }
    // lintPath = join(rulesDir, id, …) — суто package-internal (rulesDir пакета + id зі
    // selectLintRules за власним meta), не зовнішній вхід → ін'єкції немає.
    // eslint-disable-next-line no-unsanitized/method
    const mod = await import(lintPath)
    // `llmFix` (opt-in opportunistic LLM-fix, спека 2026-06-15): лише правила з
    // `meta.json: llmFix:true` отримують fix-сходинку; решта — detect-only.
    const llmFix = metaById[id]?.llmFix === true
    const code = await mod.lint(changed, cwd, { readOnly, llmFix })
    if (code !== 0) {
      if (readOnly) return { stop: true, code } // read-only — fail-fast (детект для CI)
      worst = code // fix-режим — фіксуємо, але йдемо далі до кроку виправлення
    }
  }
  return { stop: false, code: worst }
}

/**
 * Конформність-фаза `--full` (поглинула `fix`): escalation-аналітику обрамляє зсувом логу
 * (записи саме цього прогону), у fix-режимі по конформності викликає аналіз.
 * @param {string} cwd корінь
 * @param {boolean} readOnly лише детект
 * @param {(s: string) => void} log логер
 * @returns {Promise<number>} код конформності
 */
async function runFullConformancePhase(cwd, readOnly, log) {
  const { escalationLogSize, maybeAnalyzeEscalation, reportRunStats } = await import(
    '../../../scripts/lib/fix/analyze-escalation.mjs'
  )
  const escOffset = readOnly ? 0 : escalationLogSize()
  const conformanceCode = await runConformance(cwd, readOnly, log)
  if (!readOnly) {
    reportRunStats(escOffset, log) // резюме викликів моделей (локальна / cloud-min / cloud-avg)
    maybeAnalyzeEscalation(cwd, escOffset, log)
  }
  return conformanceCode
}

/**
 * Запускає lint-оркестрацію.
 * @param {{ full?: boolean, readOnly?: boolean, rules?: string[], cwd?: string, rulesDir?: string, log?: (s: string) => void }} [opts] параметри
 *   - `full` — весь репо (`true`) проти дельти vs origin (`false`, default);
 *   - `readOnly` — лише детект без мутацій (`true`) проти fix (`false`, default);
 *   - `rules` — непорожній фільтр → лише конформність цих правил (без лінтер-скану; мапить `fix <rule>`).
 * @returns {Promise<number>} exit code
 */
export async function runLint(opts = {}) {
  const full = opts.full === true
  const readOnly = opts.readOnly === true
  const rules = Array.isArray(opts.rules) ? opts.rules : []
  const cwd = opts.cwd ?? processCwd()
  const rulesDir = opts.rulesDir ?? RULES_DIR
  const log = opts.log ?? (s => process.stdout.write(s))

  // Rule-filter режим (напр. `lint changelog` із hk): лише конформність указаних правил, без лінтерів.
  if (rules.length > 0) {
    return runConformance(cwd, readOnly, log, rules)
  }

  // Default scope — дельта vs origin (merge-base main/origin/main); `--full` — весь репо.
  const changed = full ? undefined : collectChangedFilesSince(resolveChangedBase(cwd), cwd)
  if (!full && changed.length === 0) {
    log('\nℹ️  lint: немає змінених файлів відносно origin — нічого перевіряти.\n')
    return 0
  }

  const metaById = readAllMeta(rulesDir)
  const ids = selectLintRules(metaById, full)
  const perFile = await runPerFileRules(ids, { rulesDir, changed, cwd, readOnly, metaById, log })
  if (perFile.stop) return perFile.code
  let worst = perFile.code

  // Конформність-фаза: whole-repo, лише у `--full`. Кастомний rulesDir (юніт-тести
  // селектора) — реальний пакет недоступний, тож пропускаємо.
  if (full && opts.rulesDir === undefined) {
    const conformanceCode = await runFullConformancePhase(cwd, readOnly, log)
    if (conformanceCode !== 0) {
      if (readOnly) return conformanceCode
      worst = conformanceCode
    }
  }
  return worst
}
