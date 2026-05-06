/**
 * Аналіз GitHub Actions workflow на правило «depcheck для path-scoped backend-пакета»
 * (див. секцію в `npm/mdc/js-run.mdc`).
 *
 * Алгоритм для одного workspace-пакета (`<rootDir>`):
 *  1. Шукаємо всі workflow, у яких `on.push.paths` або `on.pull_request.paths` містить
 *     glob, що починається з `<rootDir>/` — це означає, що workflow обмежено саме цим пакетом
 *     (повністю або частково).
 *  2. У кожному такому workflow має бути крок, чий `run` починається з `npx depcheck …`,
 *     `working-directory` дорівнює `<rootDir>`, а список `--ignores="…"` містить
 *     щонайменше `graphql` і `bun` (інші значення допустимі).
 *
 * Якщо паттерн `paths:` стосується цього пакета, але крок depcheck відсутній / без потрібних
 * ignores / у неправильному working-directory — фіксується порушення.
 *
 * Workflow без `paths:` або з глобальними патернами (`**\/*.js`, `npm/**`) ігноруються —
 * вони не «належать» жодному окремому пакету і виходять за межі правила.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import {
  flattenWorkflowSteps,
  getStepRun,
  parseWorkflowYaml
} from './gha-workflow.mjs'

const WORKFLOWS_DIR_REL = '.github/workflows'
const REQUIRED_IGNORES = ['graphql', 'bun']
const DEPCHECK_RUN_RE = /(?:^|[\s;&|])npx\s+depcheck\b([^\n]*)/u
const IGNORES_FLAG_RE = /--ignores\s*=?\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/u

/**
 * Чи містить workflow.on[event].paths хоча б один patten, що починається з `<pkgRoot>/`.
 * @param {Record<string, unknown>} root корінь workflow
 * @param {string} pkgRoot відносний (POSIX) шлях каталогу пакета (наприклад `cron-jobs/refund-loyalty-points`)
 * @returns {boolean} `true`, якщо знайдено хоча б один підходящий glob
 */
export function workflowHasPathsScopedToPackage(root, pkgRoot) {
  const prefix = `${pkgRoot.replace(/\\/g, '/').replace(/\/+$/, '')}/`
  const on = root?.on
  if (!on || typeof on !== 'object') return false
  for (const event of /** @type {const} */ (['push', 'pull_request'])) {
    const ev = /** @type {Record<string, unknown>} */ (on)[event]
    if (!ev || typeof ev !== 'object') continue
    const paths = /** @type {Record<string, unknown>} */ (ev).paths
    if (!Array.isArray(paths)) continue
    if (paths.some(p => typeof p === 'string' && p.startsWith(prefix))) return true
  }
  return false
}

/**
 * Розбирає `--ignores="a,b,c"` (також `--ignores=a,b`, single-quotes тощо) з аргументів `npx depcheck`.
 * @param {string} depcheckArgs частина рядка `run` після `npx depcheck`
 * @returns {string[] | null} масив значень ignores або `null`, якщо прапор відсутній
 */
export function parseDepcheckIgnoresArg(depcheckArgs) {
  const m = IGNORES_FLAG_RE.exec(depcheckArgs)
  if (!m) return null
  const raw = m[1] ?? m[2] ?? m[3] ?? ''
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

/**
 * Шукає `npx depcheck` у `run` кроку. Повертає рядок аргументів після `npx depcheck` або `null`.
 * @param {string} runText значення `run:` (можливо багаторядкове)
 * @returns {string | null} текст аргументів depcheck або `null`
 */
export function extractDepcheckArgs(runText) {
  if (typeof runText !== 'string' || runText.length === 0) return null
  const m = DEPCHECK_RUN_RE.exec(runText)
  return m ? m[1] : null
}

/**
 * Чи `working-directory` кроку дорівнює очікуваному pkgRoot (з нормалізацією слешів і хвостових `/`).
 * @param {Record<string, unknown>} step об'єкт кроку
 * @param {string} pkgRoot очікуваний шлях
 * @returns {boolean} `true`, якщо збігаються
 */
export function stepWorkingDirectoryEquals(step, pkgRoot) {
  const wd = step['working-directory']
  if (typeof wd !== 'string') return false
  const norm = wd.replace(/\\/g, '/').replace(/\/+$/, '')
  const expected = pkgRoot.replace(/\\/g, '/').replace(/\/+$/, '')
  return norm === expected
}

/**
 * Перевіряє один workflow на наявність валідного depcheck-кроку для пакета.
 * @param {Record<string, unknown>} root корінь workflow
 * @param {string} pkgRoot відносний шлях пакета
 * @returns {{ kind: 'ok' } | { kind: 'missing' } | { kind: 'wrong-cwd', actual: string } | { kind: 'missing-ignores', missing: string[] }} результат
 */
export function evaluateDepcheckStepForPackage(root, pkgRoot) {
  /** @type {{ args: string, step: Record<string, unknown> }[]} */
  const depcheckSteps = []
  for (const { step } of flattenWorkflowSteps(root)) {
    const args = extractDepcheckArgs(getStepRun(step))
    if (args !== null) depcheckSteps.push({ args, step })
  }
  if (depcheckSteps.length === 0) return { kind: 'missing' }

  // Серед усіх знайдених depcheck-кроків шукаємо хоча б один, що відповідає пакету.
  const stepsForThisPackage = depcheckSteps.filter(s => stepWorkingDirectoryEquals(s.step, pkgRoot))
  if (stepsForThisPackage.length === 0) {
    const actual = depcheckSteps
      .map(s => /** @type {string} */ (s.step['working-directory'] ?? '<repo root>'))
      .join(', ')
    return { kind: 'wrong-cwd', actual }
  }

  for (const { args } of stepsForThisPackage) {
    const ignores = parseDepcheckIgnoresArg(args) ?? []
    const missing = REQUIRED_IGNORES.filter(req => !ignores.includes(req))
    if (missing.length === 0) return { kind: 'ok' }
  }
  // Усі знайдені кроки існують, але жоден не має повного списку обов'язкових ignores —
  // повертаємо missing з першого, щоб дати конкретний фідбек.
  const firstMissing = REQUIRED_IGNORES.filter(
    req => !((parseDepcheckIgnoresArg(stepsForThisPackage[0].args) ?? []).includes(req))
  )
  return { kind: 'missing-ignores', missing: firstMissing }
}

/**
 * Зчитує всі `.github/workflows/*.yml` (без `*.yaml` — за правилом n-ga) з коренем у `repoRoot`.
 * @param {string} repoRoot абсолютний корінь репозиторію
 * @returns {Promise<{ relPath: string, content: string }[]>} список workflow-файлів
 */
export async function readAllWorkflowFiles(repoRoot) {
  const dir = join(repoRoot, WORKFLOWS_DIR_REL)
  /** @type {{ relPath: string, content: string }[]} */
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.endsWith('.yml')) continue
    const abs = join(dir, ent.name)
    const content = await readFile(abs, 'utf8')
    out.push({ relPath: relative(repoRoot, abs).split('\\').join('/'), content })
  }
  return out
}

/**
 * Знаходить порушення правила depcheck для конкретного workspace-пакета.
 *
 * Повертає список повідомлень про порушення (порожній — все ok). Для кожного workflow,
 * чий `paths:` обмежено до цього пакета, перевіряє, що серед кроків є валідний `npx depcheck`
 * з потрібним `working-directory` та `--ignores`.
 * @param {{ relPath: string, content: string }[]} workflows список workflow-файлів (з `readAllWorkflowFiles`)
 * @param {string} pkgRoot відносний шлях workspace-пакета
 * @returns {string[]} повідомлення про порушення, по одному на workflow
 */
export function findDepcheckViolationsForPackage(workflows, pkgRoot) {
  /** @type {string[]} */
  const violations = []
  for (const { relPath, content } of workflows) {
    const root = parseWorkflowYaml(content)
    if (!root) continue
    if (!workflowHasPathsScopedToPackage(root, pkgRoot)) continue
    const result = evaluateDepcheckStepForPackage(root, pkgRoot)
    if (result.kind === 'ok') continue
    if (result.kind === 'missing') {
      violations.push(
        `${relPath}: paths обмежено до '${pkgRoot}/**', але немає кроку 'npx depcheck --ignores="graphql,bun"' з working-directory: ${pkgRoot}`
      )
    } else if (result.kind === 'wrong-cwd') {
      violations.push(
        `${relPath}: 'npx depcheck' знайдено, але working-directory не дорівнює '${pkgRoot}' (фактично: ${result.actual})`
      )
    } else {
      violations.push(
        `${relPath}: 'npx depcheck' у '${pkgRoot}' має містити --ignores з '${result.missing.join(',')}' (мінімум: graphql,bun)`
      )
    }
  }
  return violations
}
