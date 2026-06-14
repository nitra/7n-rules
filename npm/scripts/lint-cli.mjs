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
import { cwd as processCwd } from 'node:process'

import { parseRuleLintSpec, readRuleMetaRaw } from './lib/rule-meta.mjs'
import { collectChangedFilesSince, resolveChangedBase } from './lib/changed-files.mjs'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const RULES_DIR = join(PACKAGE_ROOT, 'rules')

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
 * @param {{ full?: boolean, readOnly?: boolean, cwd?: string, rulesDir?: string, log?: (s: string) => void }} [opts] параметри
 *   - `full` — весь репо (`true`) проти дельти vs origin (`false`, default);
 *   - `readOnly` — лише детект без мутацій (`true`) проти fix (`false`, default).
 * @returns {Promise<number>} exit code
 */
export async function runLint(opts = {}) {
  const full = opts.full === true
  const readOnly = opts.readOnly === true
  const cwd = opts.cwd ?? processCwd()
  const rulesDir = opts.rulesDir ?? RULES_DIR
  const log = opts.log ?? (s => process.stdout.write(s))

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
  return 0
}
