/** @see ./docs/deps.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { createViolationReporter } from '@7n/rules/scripts/lib/lint-surface/violation-reporter.mjs'
import { findAllPackageJsonPaths } from '@7n/rules/scripts/utils/find-package-json-paths.mjs'
import {
  findMssqlPerRequestConnectionInText,
  findSharedMssqlRequestInText,
  findUnsafeMssqlQueryTemplateCallInText,
  findUnsafeMssqlDynamicSqlListInText,
  findUnsafeMssqlInListUnparsedInText,
  findUnsafeMssqlInListMissingEmptyGuardInText,
  isMssqlScanSourceFile
} from '../lib/mssql-pool-scan.mjs'
import { loadCursorIgnorePaths } from '@7n/rules/scripts/lib/load-cursor-config.mjs'
import { walkDir } from '@7n/rules/scripts/utils/walkDir.mjs'

const VERSION_PREFIX_RE = /^[\^~>=<]+\s*/u
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)/u

/** Мінімальна дозволена версія mssql (js-mssql.mdc). */
const MIN_MSSQL_VERSION = { major: 12, minor: 5, patch: 0 }

/**
 * Збирає абсолютні шляхи JS/TS джерел у репозиторії для скану mssql.
 * @param {string} repoRoot абсолютний шлях до кореня репозиторію
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<string[]>} абсолютні шляхи, відсортовані за відносним шляхом
 */
async function findAllSourcePathsForMssqlScan(repoRoot, ignorePaths) {
  /** @type {string[]} */
  const paths = []
  await walkDir(
    repoRoot,
    absPath => {
      const rel = relative(repoRoot, absPath).split('\\').join('/')
      if (isMssqlScanSourceFile(rel)) {
        paths.push(absPath)
      }
    },
    ignorePaths
  )
  paths.sort((a, b) => relative(repoRoot, a).localeCompare(relative(repoRoot, b)))
  return paths
}

/**
 * @param {unknown} v parsed JSON
 * @returns {Record<string, unknown>} object або {}
 */
function asObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  return /** @type {Record<string, unknown>} */ (v)
}

/**
 * Витягає рядок версії `dependencies.mssql`, якщо він існує.
 * @param {unknown} deps deps з package.json
 * @returns {string | null} версія або null
 */
function getMssqlDependencyRange(deps) {
  const o = asObject(deps)
  const v = o.mssql
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * Парсить першу semver з діапазону виду "^12.5.0", ">=12.5.0", "12.5.0".
 * @param {string} range версійний діапазон
 * @returns {{ major: number, minor: number, patch: number } | null} semver або null
 */
function parseLeadingSemver(range) {
  const cleaned = String(range).trim().replace(VERSION_PREFIX_RE, '')
  const m = cleaned.match(SEMVER_RE)
  if (!m) return null
  const major = Number(m[1])
  const minor = Number(m[2])
  const patch = Number(m[3])
  if ([major, minor, patch].some(n => Number.isNaN(n))) return null
  return { major, minor, patch }
}

/**
 * @param {{ major: number, minor: number, patch: number }} a перша semver
 * @param {{ major: number, minor: number, patch: number }} b друга semver
 * @returns {boolean} true, якщо a >= b
 */
function semverGte(a, b) {
  if (a.major !== b.major) return a.major > b.major
  if (a.minor !== b.minor) return a.minor > b.minor
  return a.patch >= b.patch
}

/**
 * Аудит одного package.json на dependencies.mssql: версія має бути >=12.5.0.
 * Повертає інкремент для лічильників `{ found, bad }`.
 * @param {string} rel шлях у людино-читабельному вигляді
 * @param {unknown} parsed розпарений package.json
 * @param {(msg: string) => void} pass pass callback
 * @param {(msg: string) => void} fail fail callback
 * @returns {{ found: 0 | 1, bad: 0 | 1 }} прирости лічильників
 */
function auditMssqlVersionInPackageJson(rel, parsed, pass, fail) {
  const range = getMssqlDependencyRange(asObject(parsed).dependencies)
  if (!range) return { found: 0, bad: 0 }

  const parsedVer = parseLeadingSemver(range)
  if (!parsedVer) {
    fail(`js-mssql: ${rel}: dependencies.mssql має нечитабельну версію: ${JSON.stringify(range)} (js-mssql.mdc)`)
    return { found: 1, bad: 1 }
  }
  if (semverGte(parsedVer, MIN_MSSQL_VERSION)) {
    pass(`js-mssql: ${rel}: dependencies.mssql ${JSON.stringify(range)} (>=12.5.0)`)
    return { found: 1, bad: 0 }
  }
  fail(`js-mssql: ${rel}: dependencies.mssql ${JSON.stringify(range)} — має бути >=12.5.0 (js-mssql.mdc)`)
  return { found: 1, bad: 1 }
}

/**
 * Прогін усіх package.json: рахує знайдені mssql і ті, що не задовольняють мінімум.
 * @param {string} repoRoot корінь репозиторію
 * @param {string[]} pkgJsonPaths абсолютні шляхи до package.json
 * @param {(msg: string) => void} pass pass callback
 * @param {(msg: string) => void} fail fail callback
 * @returns {Promise<{ found: number, bad: number }>} підсумкові лічильники
 */
async function aggregateMssqlVersionsAcrossPackages(repoRoot, pkgJsonPaths, pass, fail) {
  let found = 0
  let bad = 0
  for (const absPath of pkgJsonPaths) {
    const rel = relative(repoRoot, absPath).split('\\').join('/')
    let parsed
    try {
      parsed = JSON.parse(await readFile(absPath, 'utf8'))
    } catch {
      fail(`js-mssql: ${rel} — невалідний JSON`)
      continue
    }
    const inc = auditMssqlVersionInPackageJson(rel, parsed, pass, fail)
    found += inc.found
    bad += inc.bad
  }
  return { found, bad }
}

/**
 * Підрахунок порушень у одному файлі джерела mssql.
 * Кожен лічильник інкрементується відповідним сканером, повідомлення йдуть у `fail`.
 * @param {string} rel relative-шлях файлу
 * @param {string} content вихідний код
 * @param {Record<string, number>} counters агрегатор лічильників
 * @param {(msg: string) => void} fail fail callback
 */
function scanMssqlOneSourceFile(rel, content, counters, fail) {
  for (const v of findMssqlPerRequestConnectionInText(content, rel)) {
    counters.violations++
    fail(
      `js-mssql: ${rel}:${v.line} — не створюй new sql.ConnectionPool(...) на кожен запит; використовуй singleton sql.ConnectionPool: ${v.snippet}`
    )
  }
  for (const v of findSharedMssqlRequestInText(content, rel)) {
    counters.sharedRequestViolations++
    fail(
      `js-mssql: ${rel}:${v.line} — заборонено шарити Request (наприклад export const request = pool.request()); створюй pool.request() щоразу заново (js-mssql.mdc): ${v.snippet}`
    )
  }
  for (const v of findUnsafeMssqlQueryTemplateCallInText(content, rel)) {
    counters.unsafeQueryCalls++
    fail(
      `js-mssql: ${rel}:${v.line} — заборонено query(\`...\`): це не tagged template; використовуй pool.request().query\`...\` (js-mssql.mdc): ${v.snippet}`
    )
  }
  for (const v of findUnsafeMssqlDynamicSqlListInText(content, rel)) {
    counters.unsafeDynamicSqlLists++
    fail(
      `js-mssql: ${rel}:${v.line} — заборонено підставляти у SQL динамічні списки через .join(',') (типово IN (...) / VALUES (...)); використовуй TVP (sql.Table) + JOIN/INSERT (js-mssql.mdc): ${v.snippet}`
    )
  }
  for (const v of findUnsafeMssqlInListUnparsedInText(content, rel)) {
    counters.unparsedInLists++
    fail(
      `js-mssql: ${rel}:${v.line} — у SQL IN (\${...}) значення мають бути попередньо приведені числовим парсером (parseInt/Number/BigInt/parseFloat) і відфільтровані від NaN, інакше можливий SQL injection (js-mssql.mdc): ${v.snippet}`
    )
  }
  for (const v of findUnsafeMssqlInListMissingEmptyGuardInText(content, rel)) {
    counters.inListGuardViolations++
    if (v.reason === 'missing_guard') {
      fail(
        `js-mssql: ${rel}:${v.line} — перед IN-списком ${JSON.stringify(v.name)} потрібна перевірка на пустоту з throw ` +
          `(наприклад if (!${v.name}.length) throw ...), інакше можливі некоректні запити (js-mssql.mdc): ${v.snippet}`
      )
    } else {
      fail(
        `js-mssql: ${rel}:${v.line} — значення для IN (\${...}) у template literal треба винести в окрему змінну ` +
          `і перевірити на пустоту (throw), не підставляти вираз напряму (js-mssql.mdc): ${v.snippet}`
      )
    }
  }
}

/**
 * Звіт про відсутність порушень у джерелах mssql: кожен лічильник із 0 → один pass-рядок.
 * @param {Record<string, number>} counters лічильники після проходу всіх файлів
 * @param {(msg: string) => void} pass pass callback
 */
function reportZeroMssqlSourceViolations(counters, pass) {
  if (counters.violations === 0) {
    pass('js-mssql: немає створення new sql.ConnectionPool(...) всередині функцій (singleton pool)')
  }
  if (counters.sharedRequestViolations === 0) {
    pass('js-mssql: немає shared Request (export const request = pool.request())')
  }
  if (counters.unsafeQueryCalls === 0) {
    pass('js-mssql: немає небезпечних викликів query(`...`) (потрібно query`...`)')
  }
  if (counters.unsafeDynamicSqlLists === 0) {
    pass("js-mssql: немає небезпечних динамічних SQL-списків через .join(',') у IN/VALUES")
  }
  if (counters.unparsedInLists === 0) {
    pass(`js-mssql: немає підстановок IN (\${...}) без числового парсера значень`)
  }
  if (counters.inListGuardViolations === 0) {
    pass('js-mssql: усі IN-списки винесені у змінні та мають перевірку на пустоту з throw')
  }
}

/**
 * Аудит усіх JS/TS-джерел репо щодо безпечного використання mssql.
 * @param {string} repoRoot корінь репозиторію
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @param {(msg: string) => void} pass pass callback
 * @param {(msg: string) => void} fail fail callback
 * @returns {Promise<void>} визначається по завершенню аудиту всіх знайдених джерел
 */
async function auditMssqlSources(repoRoot, ignorePaths, pass, fail) {
  const sourcePaths = await findAllSourcePathsForMssqlScan(repoRoot, ignorePaths)
  if (sourcePaths.length === 0) {
    pass('js-mssql: немає JS/TS файлів для скану singleton ConnectionPool')
    return
  }

  const counters = {
    violations: 0,
    sharedRequestViolations: 0,
    unsafeQueryCalls: 0,
    unsafeDynamicSqlLists: 0,
    unparsedInLists: 0,
    inListGuardViolations: 0
  }
  for (const absPath of sourcePaths) {
    const rel = relative(repoRoot, absPath).split('\\').join('/')
    const content = await readFile(absPath, 'utf8')
    scanMssqlOneSourceFile(rel, content, counters, fail)
  }

  reportZeroMssqlSourceViolations(counters, pass)
}

/**
 * Перевіряє відповідність проєкту правилу js-mssql.mdc
 * @param {import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('@7n/rules/scripts/lib/lint-surface/types.mjs').LintResult>} перелік порушень
 */
export async function lint(ctx) {
  const reporter = createViolationReporter(ctx)
  const { pass, fail } = reporter

  const repoRoot = ctx.cwd
  if (!existsSync(join(repoRoot, 'package.json'))) {
    pass('js-mssql: package.json у корені відсутній — перевірку пропущено')
    return reporter.result()
  }

  const ignorePaths = await loadCursorIgnorePaths(repoRoot)
  const pkgJsonPaths = await findAllPackageJsonPaths(repoRoot, ignorePaths)
  if (pkgJsonPaths.length === 0) {
    pass('js-mssql: package.json не знайдено — перевірку пропущено')
    return reporter.result()
  }

  const { found, bad } = await aggregateMssqlVersionsAcrossPackages(repoRoot, pkgJsonPaths, pass, fail)

  if (found === 0) {
    pass('js-mssql: пакет mssql не знайдено в dependencies жодного package.json')
    return reporter.result()
  }
  if (bad === 0) {
    pass(`js-mssql: всі знайдені dependencies.mssql відповідають мінімальній версії 12.5.0 (${found})`)
  }

  await auditMssqlSources(repoRoot, ignorePaths, pass, fail)

  return reporter.result()
}
