/** @see ./docs/run-lint.md */
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cwd as processCwd } from 'node:process'
import { spawnSync } from 'node:child_process'

import picomatch from 'picomatch'

import { parseRuleAutoSpec, parseRuleLintSpec, readRuleMetaRaw } from './rule-meta.mjs'
import { collectChangedFilesSince, resolveChangedBase } from './changed-files.mjs'
import { resolveCmd } from '../utils/resolve-cmd.mjs'
import { isRuleEnabled, readNCursorConfigLite } from './read-n-cursor-config-lite.mjs'

// Цей файл: npm/scripts/lib/run-lint.mjs → PACKAGE_ROOT = npm (два dirname угору).
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const RULES_DIR = join(PACKAGE_ROOT, 'rules')

/**
 * Чи має правило лінт-поверхню — `meta.json#lint` задано (`per-file`/`full`).
 * Канонічний сигнал (ADR 2026-06-21): gate за meta, не за наявністю файлу.
 * @param {Record<string, unknown> | undefined} raw meta-обʼєкт правила
 * @returns {boolean} true — правило лінтить
 */
function hasLintSurface(raw) {
  return parseRuleLintSpec(raw?.lint) !== null
}

/**
 * Резолвить лінт-entrypoint правила: `main.mjs` з експортом `lint` (канон, ADR 2026-06-21).
 * @param {string} rulesDir каталог rules
 * @param {string} id rule-id
 * @returns {string | null} шлях до `main.mjs`, або null якщо файлу нема
 */
function resolveLintEntrypoint(rulesDir, id) {
  const main = join(rulesDir, id, 'main.mjs')
  return existsSync(main) ? main : null
}

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
 * Вибирає id правил для контексту, алфавітно.
 * @param {Record<string, {lint?: unknown}>} metaById мапа id → meta-обʼєкт
 * @param {boolean} full `false` → лише `per-file` правила; `true` → усі (`per-file` ∪ `full`)
 * @param {string[]} enabledRuleIds активні rule-id з `.n-cursor.json`
 * @returns {string[]} відсортовані id
 */
export function selectLintRules(metaById, full, enabledRuleIds) {
  const enabled = new Set(enabledRuleIds)
  const out = []
  for (const [id, raw] of Object.entries(metaById)) {
    if (!enabled.has(id)) continue
    const scope = parseRuleLintSpec(raw?.lint)
    if (scope === 'per-file' || (full && scope === 'full')) out.push(id)
  }
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Визначає `full`-scope правила для запуску у delta-режимі.
 * Правило включається, якщо хоча б один зі змінених файлів відповідає `auto.glob` правила.
 * Предикат-auto (repo-level сигнал, не file-level) — пропускається.
 * @param {Record<string, Record<string, unknown>>} metaById
 * @param {string[]} changed змінені файли (posix-відносні від кореня)
 * @param {string[]} enabledRuleIds активні rule-id
 * @returns {string[]} відсортовані id
 */
function selectFullRulesForDelta(metaById, changed, enabledRuleIds) {
  if (changed.length === 0) return []
  const enabled = new Set(enabledRuleIds)
  const out = []
  for (const [id, raw] of Object.entries(metaById)) {
    if (!enabled.has(id)) continue
    if (parseRuleLintSpec(raw?.lint) !== 'full') continue
    const autoSpec = parseRuleAutoSpec(raw?.auto)
    if (!autoSpec || !('glob' in autoSpec)) continue
    const isMatch = picomatch(autoSpec.glob, { dot: true })
    if (changed.some(f => isMatch(f))) out.push(id)
  }
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * Активні правила для unscoped linter-фази. `.n-cursor.json` — єдине джерело
 * whitelist/disable, `meta.json#lint` нижче використовується лише як scope (`per-file`/`full`).
 * @param {Record<string, unknown>} metaById доступні bundled правила
 * @param {string} cwd корінь
 * @returns {Promise<string[]>} активні rule-id з конфіга, що існують у пакеті
 */
async function readEnabledLintRuleIds(metaById, cwd) {
  const config = await readNCursorConfigLite(cwd)
  if (!config.exists) return []
  return Object.keys(metaById).filter(id => isRuleEnabled(config, id))
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
    const lintPath = resolveLintEntrypoint(rulesDir, id)
    if (!lintPath) {
      log(`⚠️  lint: правило ${id} має lint-фазу (meta.lint), але немає main.mjs — пропускаю.\n`)
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
 * Конформність-фаза `--full`.
 * @param {string} cwd корінь
 * @param {boolean} readOnly лише детект
 * @param {(s: string) => void} log логер
 * @returns {Promise<number>} код конформності
 */
async function runFullConformancePhase(cwd, readOnly, log) {
  return runConformance(cwd, readOnly, log)
}

/**
 * Формат-крок (`oxfmt .`): whole-tree форматування у fix-режимі. У read-only НЕ викликається
 * (CI/детект — нуль мутацій). `oxfmt` форматує не лише JS, а й root-конфіги (toml тощо), тож
 * крок незалежний від набору правил і scope. Якщо `oxfmt` відсутній у PATH — пропуск (не fail).
 * @param {string} cwd корінь
 * @param {(s: string) => void} log логер
 * @returns {Promise<number>} код виходу oxfmt (0 — OK або пропущено)
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
 * Scoped-режим (`lint <rule…>`): повний прогін НАЗВАНИХ правил — їх лінтер (entrypoint
 * `main.mjs::lint`, whole-repo) для тих, що мають лінт-поверхню
 * (`meta.json#lint`), + конформність для всіх названих. Дзеркалить `--full`, але звужено
 * до правил, тож `lint ga` ≡ standalone `lint-ga`. Конформність-only правила (напр.
 * `changelog` із hk) без `meta.lint` → проганяється лише їх конформність (зворотна
 * сумісність із колишнім `fix <rule>`). oxfmt у scoped НЕ запускається — це
 * таргетований прогін правил, а не глобальне форматування.
 * @param {string[]} rules id названих правил
 * @param {{ cwd: string, readOnly: boolean, rulesDir: string, conformance: boolean, log: (s: string) => void }} ctx контекст (`conformance` — чи запускати конформність; false для юніт-тестів із кастомним rulesDir, де реальний пакет недоступний)
 * @returns {Promise<number>} найгірший код (read-only — fail-fast на першому ненульовому)
 */
async function runScopedRules(rules, ctx) {
  const { cwd, readOnly, rulesDir, conformance, log } = ctx
  const metaById = readAllMeta(rulesDir)
  const linterIds = rules.filter(id => hasLintSurface(metaById[id]))
  let worst = 0
  if (linterIds.length > 0) {
    const perFile = await runPerFileRules(linterIds, { rulesDir, changed: undefined, cwd, readOnly, metaById, log })
    if (perFile.stop) return perFile.code
    worst = perFile.code
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
 * @param {{ full?: boolean, readOnly?: boolean, rules?: string[], files?: string[], cwd?: string, rulesDir?: string, log?: (s: string) => void }} [opts] параметри
 *   - `full` — весь репо (`true`) проти дельти vs origin (`false`, default);
 *   - `readOnly` — лише детект без мутацій (`true`) проти fix (`false`, default);
 *   - `rules` — непорожній scope → повний прогін лише цих правил (лінтер + конформність, whole-repo);
 *   - `files` — явний список файлів (hook-режим): per-file правила без conformance/format/delta-full.
 * @returns {Promise<number>} exit code
 */
export async function runLint(opts = {}) {
  const full = opts.full === true
  const readOnly = opts.readOnly === true
  const rules = Array.isArray(opts.rules) ? opts.rules : []
  const explicitFiles = Array.isArray(opts.files) ? opts.files : null
  const cwd = opts.cwd ?? processCwd()
  const rulesDir = opts.rulesDir ?? RULES_DIR
  const log = opts.log ?? (s => process.stdout.write(s))

  // Scoped режим (`lint <rule…>`): повний прогін названих правил — лінтер + конформність.
  if (rules.length > 0) {
    return runScopedRules(rules, { cwd, readOnly, rulesDir, conformance: opts.rulesDir === undefined, log })
  }

  // Hook-режим (явний список файлів): per-file правила, без conformance/format/delta-full.
  // Правила отримують точний список файлів; пусті files (Stop без змін) — правила однаково
  // викликаються (orphan-детект у doc-files не залежить від списку джерел).
  if (explicitFiles !== null) {
    const metaById = readAllMeta(rulesDir)
    const enabledRuleIds = await readEnabledLintRuleIds(metaById, cwd)
    const ids = selectLintRules(metaById, false, enabledRuleIds)
    const perFile = await runPerFileRules(ids, { rulesDir, changed: explicitFiles, cwd, readOnly, metaById, log })
    return perFile.stop ? perFile.code : perFile.code
  }

  // Default scope — дельта vs origin (merge-base main/origin/main); `--full` — весь репо.
  const changed = full ? undefined : collectChangedFilesSince(resolveChangedBase(cwd), cwd)
  if (!full && changed.length === 0) {
    log('\nℹ️  lint: немає змінених файлів відносно origin — нічого перевіряти.\n')
    return 0
  }

  const metaById = readAllMeta(rulesDir)
  const enabledRuleIds = await readEnabledLintRuleIds(metaById, cwd)
  const ids = selectLintRules(metaById, full, enabledRuleIds)
  const perFile = await runPerFileRules(ids, { rulesDir, changed, cwd, readOnly, metaById, log })
  if (perFile.stop) return perFile.code
  let worst = perFile.code

  // Delta-режим: `full`-scope правила, чиї glob-и перетинаються з changed.
  // Запускаємо з `changed=undefined` (whole-repo scan як зазвичай) — так уникаємо
  // прогону docker/ga/k8s… коли жоден їхній файл не змінився.
  if (!full && changed.length > 0) {
    const fullIds = selectFullRulesForDelta(metaById, changed, enabledRuleIds)
    if (fullIds.length > 0) {
      const fullResult = await runPerFileRules(fullIds, { rulesDir, changed: undefined, cwd, readOnly, metaById, log })
      if (fullResult.stop) return fullResult.code
      if (fullResult.code !== 0) worst = fullResult.code
    }
  }

  // Конформність-фаза: whole-repo, лише у `--full`. Кастомний rulesDir (юніт-тести
  // селектора) — реальний пакет недоступний, тож пропускаємо.
  if (full && opts.rulesDir === undefined) {
    const conformanceCode = await runFullConformancePhase(cwd, readOnly, log)
    if (conformanceCode !== 0) {
      if (readOnly) return conformanceCode
      worst = conformanceCode
    }
  }

  // Формат-крок (oxfmt): fix-режим — завжди (будь-який scope); read-only пропускаємо (нуль
  // мутацій). Кастомний rulesDir (юніт-тести) — реальний пакет недоступний, тож пропускаємо.
  if (!readOnly && opts.rulesDir === undefined) {
    const fmtCode = runFormat(cwd, log)
    if (fmtCode !== 0) worst = fmtCode
  }
  return worst
}
