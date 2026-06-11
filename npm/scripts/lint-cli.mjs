/**
 * Оркестратор `n-cursor lint` (quick) / `n-cursor lint-ci` (full).
 *
 * Data-driven: сканує `rules/<id>/meta.json` за полем `lint` (`quick`|`ci`),
 * послідовно (заборона паралельного eslint) викликає `rules/<id>/js/lint.mjs`:
 *  - quick: `lint(changedFiles)` — лише змінені файли (git diff HEAD + untracked);
 *  - ci:    `lint(undefined)` — весь проєкт.
 * Порядок правил — алфавітний; ci-набір = quick ∪ ci. Fail-fast: перший ненульовий код спиняє.
 */
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cwd as processCwd } from 'node:process'

import { parseRuleLintPhase, readRuleMetaRaw } from './lib/rule-meta.mjs'
import { collectChangedFiles } from './lib/changed-files.mjs'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const RULES_DIR = join(PACKAGE_ROOT, 'rules')

/**
 * Вибирає id правил для фази, алфавітно.
 * @param {Record<string, {lint?: unknown}>} metaById мапа id → meta-обʼєкт
 * @param {'quick'|'ci'} phase цільова фаза (quick → лише quick; ci → quick+ci)
 * @returns {string[]} відсортовані id
 */
export function selectLintRules(metaById, phase) {
  const out = []
  for (const [id, raw] of Object.entries(metaById)) {
    const p = parseRuleLintPhase(raw?.lint)
    if (p === 'quick' || (phase === 'ci' && p === 'ci')) out.push(id)
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
 * @param {{ ci?: boolean, cwd?: string, rulesDir?: string, log?: (s: string) => void }} [opts] параметри
 * @returns {Promise<number>} exit code
 */
export async function runLint(opts = {}) {
  const ci = opts.ci === true
  const cwd = opts.cwd ?? processCwd()
  const rulesDir = opts.rulesDir ?? RULES_DIR
  const log = opts.log ?? (s => process.stdout.write(s))

  const changed = ci ? undefined : collectChangedFiles(cwd)
  if (!ci && changed.length === 0) {
    log('\nℹ️  lint: немає змінених файлів — нічого перевіряти.\n')
    return 0
  }

  const ids = selectLintRules(readAllMeta(rulesDir), ci ? 'ci' : 'quick')
  for (const id of ids) {
    const lintPath = join(rulesDir, id, 'js', 'lint.mjs')
    if (!existsSync(lintPath)) {
      log(`⚠️  lint: правило ${id} має lint-фазу, але немає js/lint.mjs — пропускаю.\n`)
      continue
    }
    const mod = await import(lintPath)
    const code = await mod.lint(changed, cwd)
    if (code !== 0) return code
  }
  return 0
}
