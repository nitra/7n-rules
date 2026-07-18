/**
 * `n-rules ci plan` — skip-логіка сервіс-орієнтованого CI-канону (спільна для
 * GitHub Actions і Azure Pipelines): рахує перетин git-дельти з `--path`
 * (каталог сервісу) і по glob-ах per-file concerns визначає, які lint-домени
 * взагалі мають запускатись. Виходи — job outputs обох CI: гейт-джоба `plan`
 * емить `js=true|false`, а lint-джоби умовно скіпаються (`if:`/`condition:`).
 *
 * Read-only: без глобального лока, без мутації package.json, без root-guard.
 * Джерело правди активності домену — `computeActiveDomains` (та сама таблиця
 * planConcernForDelta, що й `lint <domain> --path`): «plan сказав true» ⇔
 * «lint щось запустить».
 *
 * Fail-open: якщо база дельти не резолвиться (немає main/origin/main чи
 * `--base`-ref) — warning і ВСІ домени true (запускаємо більше, ніколи не
 * скіпаємо мовчки).
 */
import { appendFileSync } from 'node:fs'
import { env } from 'node:process'

import picomatch from 'picomatch'

import { resolveChangedBase, collectChangedFilesSince } from '../changed-files.mjs'
import { collectPathScopedChangedFiles, collectPathScopedFiles } from './path-scope.mjs'
import { loadEnabledLintRules, computeActiveDomains } from './run-detectors.mjs'

/** Глоби тест-файлів для виходу `has_tests` (bun test / vitest / pytest). */
const TEST_FILE_GLOBS = ['**/*.test.*', '**/*.spec.*', '**/test_*.py', '**/*_test.py', '**/tests/**']

/** Зарезервовані ключі outputs — домен із таким ключем був би колізією. */
const RESERVED_OUTPUT_KEYS = new Set(['any', 'has_tests', 'domains'])

/**
 * Rule-id → ключ output-змінної: `-` → `_` (GA/Azure не люблять дефіси в
 * іменах змінних; `npm-module` → `npm_module`).
 * @param {string} ruleId rule-id домену.
 * @returns {string} ключ output.
 */
function domainKey(ruleId) {
  return ruleId.replaceAll('-', '_')
}

/**
 * @typedef {object} CiPlan
 * @property {string|null} path значення `--path` (каталог сервісу) або null (repo-wide).
 * @property {boolean} baseResolved чи резолвнулась база дельти (false → fail-open, всі true).
 * @property {number|null} changedCount кількість файлів у наборі (null при fail-open).
 * @property {boolean} hasChanges чи набір непорожній (гейт тест-джоби `any`).
 * @property {boolean} hasTests чи є тест-файли в піддереві (статично, незалежно від дельти).
 * @property {{ id: string, key: string, triggered: boolean, matchedFiles: number }[]} domains стан доменів (сортовано за id).
 */

/**
 * Обчислює план CI для `--path` (сервіс) або всього репо (без `--path`).
 * @param {{ cwd: string, pathArg?: string|null, baseRef?: string|null, rulesDir?: string, rulesDirs?: string[] }} opts корінь, каталог сервісу, явна база; rulesDir(s) — для тестів.
 * @returns {Promise<CiPlan>} план для рендерерів.
 */
export async function computeCiPlan({ cwd, pathArg = null, baseRef = null, rulesDir, rulesDirs }) {
  const { byRule, enabledSet } = await loadEnabledLintRules({ cwd, rulesDir, rulesDirs })

  /** @type {string[]|null} */
  let changed = null
  if (pathArg === null) {
    const base = resolveChangedBase(cwd, baseRef)
    if (base !== null) changed = collectChangedFilesSince(base, cwd)
  } else {
    const r = await collectPathScopedChangedFiles(cwd, pathArg, { baseRef })
    if (r.baseResolved) changed = r.files
  }
  const baseResolved = changed !== null

  // Домени = enabled-правила з ≥1 per-file concern (computeActiveDomains
  // не повертає правила без per-file поверхонь — їм нема чого скіпати).
  const active = computeActiveDomains(byRule, enabledSet, changed ?? [])
  const domains = Array.from(active.entries(), ([id, st]) => ({
    id,
    key: domainKey(id),
    triggered: baseResolved ? st.triggered : true,
    matchedFiles: baseResolved ? st.matchedFiles : 0
  })).toSorted((a, b) => a.id.localeCompare(b.id))

  const keys = new Set()
  for (const d of domains) {
    if (keys.has(d.key) || RESERVED_OUTPUT_KEYS.has(d.key)) {
      throw new Error(`ci plan: колізія ключа output «${d.key}» (домен ${d.id})`)
    }
    keys.add(d.key)
  }

  // has_tests — статична наявність тест-файлів у піддереві (не залежить від
  // дельти): консюмер вирішує, чи взагалі мати test-джобу в pipeline сервісу.
  const subtree = await collectPathScopedFiles(cwd, pathArg ?? '.')
  const isTest = picomatch(TEST_FILE_GLOBS, { dot: true })
  const hasTests = subtree.some(f => isTest(f))

  return {
    path: pathArg,
    baseResolved,
    changedCount: baseResolved ? /** @type {string[]} */ (changed).length : null,
    hasChanges: baseResolved ? /** @type {string[]} */ (changed).length > 0 : true,
    hasTests,
    domains
  }
}

/**
 * Людиночитаний рендер плану (дефолтний stdout-вивід).
 * @param {CiPlan} plan обчислений план.
 * @returns {string} багаторядковий текст.
 */
export function renderCiPlanHuman(plan) {
  const lines = []
  const where = plan.path === null ? 'весь репозиторій' : `--path ${plan.path}`
  if (plan.baseResolved) {
    lines.push(`📋 ci plan (${where}): ${plan.changedCount} змінених файлів у наборі`)
  } else {
    lines.push(`⚠️ ci plan (${where}): база дельти не резолвиться — fail-open, усі домени true`)
  }
  for (const d of plan.domains) {
    const suffix = d.matchedFiles > 0 ? ` (${d.matchedFiles} файл(ів))` : ''
    lines.push(`  ${d.triggered ? '✅' : '⏭️'} ${d.id}${suffix}`)
  }
  lines.push(`  any=${plan.hasChanges} has_tests=${plan.hasTests}`)
  return `${lines.join('\n')}\n`
}

/**
 * Рядки `name=value` для `$GITHUB_OUTPUT` (по одному на домен + агрегати).
 * Значення — лише `true|false` або JSON-масив id ([a-z0-9_-]) — інʼєкція в
 * output-файл неможлива за конструкцією.
 * @param {CiPlan} plan обчислений план.
 * @returns {string[]} рядки для append у файл `$GITHUB_OUTPUT`.
 */
export function renderCiPlanGithubLines(plan) {
  const lines = plan.domains.map(d => `${d.key}=${d.triggered}`)
  lines.push(
    `any=${plan.hasChanges}`,
    `has_tests=${plan.hasTests}`,
    `domains=${JSON.stringify(plan.domains.filter(d => d.triggered).map(d => d.id))}`
  )
  return lines
}

/**
 * Один logging command Azure Pipelines для output-змінної.
 * @param {string} k ключ змінної.
 * @param {boolean|string} v значення.
 * @returns {string} `##vso`-рядок.
 */
function vso(k, v) {
  return `##vso[task.setvariable variable=${k};isOutput=true]${v}`
}

/**
 * Logging commands Azure Pipelines (`##vso[task.setvariable …;isOutput=true]`)
 * — stdout-рядки; downstream-джоби читають `dependencies.<job>.outputs['plan.<key>']`
 * (крок мусить мати `name: plan`).
 * @param {CiPlan} plan обчислений план.
 * @returns {string[]} рядки для stdout.
 */
export function renderCiPlanAzureLines(plan) {
  const lines = plan.domains.map(d => vso(d.key, d.triggered))
  lines.push(
    vso('any', plan.hasChanges),
    vso('has_tests', plan.hasTests),
    vso('domains', JSON.stringify(plan.domains.filter(d => d.triggered).map(d => d.id)))
  )
  return lines
}

/**
 * CLI-хендлер `n-rules ci <subcommand>`. Наразі єдина підкоманда — `plan`.
 * Прапори: `--path <dir>`, `--base <ref>`, `--cwd <dir>`, `--github` (append
 * у `$GITHUB_OUTPUT`), `--azure` (`##vso`-рядки в stdout), `--json`.
 * @param {string[]} args аргументи після `ci`.
 * @returns {Promise<number>} exit code.
 */
export async function runCiPlanCli(args) {
  const [sub, ...rest] = args
  if (sub !== 'plan') {
    console.error(
      `❌ Невідома підкоманда ci: ${sub ?? '(порожньо)'} — очікується: n-rules ci plan [--path <dir>] [--base <ref>] [--github|--azure|--json]`
    )
    return 1
  }
  const valueOf = flag => {
    const i = rest.indexOf(flag)
    return i === -1 ? null : (rest[i + 1] ?? null)
  }
  const cwd = valueOf('--cwd') ?? process.cwd()
  const pathArg = valueOf('--path')
  const baseRef = valueOf('--base')

  const plan = await computeCiPlan({ cwd, pathArg, baseRef })
  if (!plan.baseResolved) {
    console.error(
      '⚠️ ci plan: база дельти не резолвиться (немає main/origin/main чи --base-ref у клоні) — fail-open: усі домени true. У CI перевірте fetch-depth/git fetch і прапорець --base.'
    )
  }

  if (rest.includes('--json')) {
    console.log(JSON.stringify(plan, null, 2))
    return 0
  }
  if (rest.includes('--github')) {
    const outFile = env.GITHUB_OUTPUT
    if (!outFile) {
      console.error('❌ ci plan --github: змінна середовища GITHUB_OUTPUT відсутня (запуск поза GitHub Actions?)')
      return 1
    }
    appendFileSync(outFile, `${renderCiPlanGithubLines(plan).join('\n')}\n`)
    process.stdout.write(renderCiPlanHuman(plan))
    return 0
  }
  if (rest.includes('--azure')) {
    process.stdout.write(`${renderCiPlanAzureLines(plan).join('\n')}\n`)
    process.stdout.write(renderCiPlanHuman(plan))
    return 0
  }
  process.stdout.write(renderCiPlanHuman(plan))
  return 0
}
