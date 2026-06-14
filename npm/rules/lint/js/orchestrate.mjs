/**
 * Оркестратор `n-cursor lint` — дві ортогональні осі (spec 2026-06-14-lint-rule-consolidation
 * + компаньйон 2026-06-14-lint-orchestrator-fix-readonly-unification):
 *  - **scope** (`--full`): default = дельта vs origin (лише `per-file` правила);
 *    `--full` = весь репо (`per-file` ∪ `full` правила);
 *  - **behavior** (`--read-only`): default = fix; `--read-only` = лише детект без мутацій.
 *
 * Data-driven: сканує `rules/<id>/meta.json` за полем `lint` (`per-file`|`full`),
 * викликає `rules/<id>/js/lint.mjs` → `lint(files, cwd, { readOnly })`:
 *  - default scope: `files` = змінені відносно origin (`collectChangedFilesSince`);
 *  - `--full`:      `files = undefined` — весь проєкт.
 * Порядок правил — алфавітний. Fail-fast: перший ненульовий код спиняє.
 */
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { cwd as processCwd } from 'node:process'

import { parseRuleLintSpec, readRuleMetaRaw } from '../../../scripts/lib/rule-meta.mjs'
import { collectChangedFilesSince, resolveChangedBase } from '../../../scripts/lib/changed-files.mjs'

// Цей файл: npm/rules/lint/js/orchestrate.mjs → PACKAGE_ROOT = npm (чотири dirname угору).
const PACKAGE_ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))))
const RULES_DIR = join(PACKAGE_ROOT, 'rules')
const N_CURSOR_BIN = join(PACKAGE_ROOT, 'bin', 'n-cursor.js')

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
  const r = spawnSync('bun', [N_CURSOR_BIN, '_fix-check', ...filter], { cwd, encoding: 'utf8', timeout: 600_000 })
  let parsed = null
  try {
    parsed = JSON.parse((r.stdout ?? '').trim())
  } catch {
    parsed = null
  }
  if (!parsed) {
    log('❌ lint: конформність — помилка перевірки (_fix-check не повернув JSON)\n')
    return 1
  }
  const failed = parsed.rules.filter(/** @param {{ok:boolean}} x */ x => !x.ok)
  if (failed.length === 0) return 0
  log(`❌ lint: конформність — ${failed.length} порушень: ${failed.map(/** @param {{ruleId:string}} x */ x => x.ruleId).join(', ')}\n`)
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

  const ids = selectLintRules(readAllMeta(rulesDir), full)
  for (const id of ids) {
    const lintPath = join(rulesDir, id, 'js', 'lint.mjs')
    if (!existsSync(lintPath)) {
      log(`⚠️  lint: правило ${id} має lint-фазу, але немає js/lint.mjs — пропускаю.\n`)
      continue
    }
    const mod = await import(lintPath)
    const code = await mod.lint(changed, cwd, { readOnly })
    if (code !== 0) return code
  }

  // Конформність-фаза (поглинула `fix`): whole-repo, лише у `--full`. Кастомний rulesDir
  // (юніт-тести селектора) — реальний пакет недоступний, тож пропускаємо.
  if (full && opts.rulesDir === undefined) {
    const conformanceCode = await runConformance(cwd, readOnly, log)
    if (conformanceCode !== 0) return conformanceCode
  }
  return 0
}
