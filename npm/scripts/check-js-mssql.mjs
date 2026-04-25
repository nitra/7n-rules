/**
 * Перевіряє правило js-mssql.mdc.
 *
 * Якщо в будь-якому `package.json` у репозиторії (включно з workspace-пакетами) в секції `dependencies`
 * присутній пакет `mssql`, його версія має бути не менше 12.5.0.
 *
 * Додатково, якщо `mssql` використовується в репозиторії, перевіряє що підключення
 * не створюється “на кожен запит”: `new sql.ConnectionPool(...)` не має знаходитись
 * всередині функцій. Пул має бути singleton (на рівні модуля) і повторно використовуватись.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import { createCheckReporter } from './utils/check-reporter.mjs'
import {
  findMssqlPerRequestConnectionInText,
  findUnsafeMssqlQueryTemplateCallInText,
  isMssqlScanSourceFile
} from './utils/mssql-pool-scan.mjs'
import { walkDir } from './utils/walkDir.mjs'

const VERSION_PREFIX_RE = /^[\^~>=<]+\s*/u
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)/u

/** Мінімальна дозволена версія mssql (js-mssql.mdc). */
const MIN_MSSQL_VERSION = { major: 12, minor: 5, patch: 0 }

/**
 * Знаходить всі `package.json` у репозиторії (крім пропущених директорій у walkDir).
 * @param {string} repoRoot абсолютний шлях до кореня репозиторію
 * @returns {Promise<string[]>} абсолютні шляхи, відсортовані за відносним шляхом
 */
async function findAllPackageJsonPaths(repoRoot) {
  /** @type {string[]} */
  const paths = []
  await walkDir(repoRoot, absPath => {
    if (absPath.endsWith(`${sep}package.json`)) {
      paths.push(absPath)
    }
  })
  paths.sort((a, b) => relative(repoRoot, a).localeCompare(relative(repoRoot, b)))
  return paths
}

/**
 * Збирає абсолютні шляхи JS/TS джерел у репозиторії для скану mssql.
 * @param {string} repoRoot абсолютний шлях до кореня репозиторію
 * @returns {Promise<string[]>} абсолютні шляхи, відсортовані за відносним шляхом
 */
async function findAllSourcePathsForMssqlScan(repoRoot) {
  /** @type {string[]} */
  const paths = []
  await walkDir(repoRoot, absPath => {
    const rel = relative(repoRoot, absPath).split('\\').join('/')
    if (isMssqlScanSourceFile(rel)) {
      paths.push(absPath)
    }
  })
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
 * @param {{ major: number, minor: number, patch: number }} a
 * @param {{ major: number, minor: number, patch: number }} b
 * @returns {boolean} true, якщо a >= b
 */
function semverGte(a, b) {
  if (a.major !== b.major) return a.major > b.major
  if (a.minor !== b.minor) return a.minor > b.minor
  return a.patch >= b.patch
}

/**
 * Перевіряє відповідність проєкту правилу js-mssql.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass, fail } = reporter

  const repoRoot = process.cwd()
  const rootPkg = join(repoRoot, 'package.json')
  if (!existsSync(rootPkg)) {
    pass('js-mssql: package.json у корені відсутній — перевірку пропущено')
    return reporter.getExitCode()
  }

  const pkgJsonPaths = await findAllPackageJsonPaths(repoRoot)
  if (pkgJsonPaths.length === 0) {
    pass('js-mssql: package.json не знайдено — перевірку пропущено')
    return reporter.getExitCode()
  }

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
    const range = getMssqlDependencyRange(parsed.dependencies)
    if (range) {
      found++
      const parsedVer = parseLeadingSemver(range)
      if (!parsedVer) {
        bad++
        fail(`js-mssql: ${rel}: dependencies.mssql має нечитабельну версію: ${JSON.stringify(range)} (js-mssql.mdc)`)
        continue
      }
      if (semverGte(parsedVer, MIN_MSSQL_VERSION)) {
        pass(`js-mssql: ${rel}: dependencies.mssql ${JSON.stringify(range)} (>=12.5.0)`)
      } else {
        bad++
        fail(`js-mssql: ${rel}: dependencies.mssql ${JSON.stringify(range)} — має бути >=12.5.0 (js-mssql.mdc)`)
      }
    }
  }

  if (found === 0) {
    pass('js-mssql: пакет mssql не знайдено в dependencies жодного package.json')
  } else if (bad === 0) {
    pass(`js-mssql: всі знайдені dependencies.mssql відповідають мінімальній версії 12.5.0 (${found})`)
  }

  if (found > 0) {
    const sourcePaths = await findAllSourcePathsForMssqlScan(repoRoot)
    if (sourcePaths.length === 0) {
      pass('js-mssql: немає JS/TS файлів для скану singleton ConnectionPool')
      return reporter.getExitCode()
    }

    let violations = 0
    let unsafeQueryCalls = 0
    for (const absPath of sourcePaths) {
      const rel = relative(repoRoot, absPath).split('\\').join('/')
      const content = await readFile(absPath, 'utf8')
      for (const v of findMssqlPerRequestConnectionInText(content, rel)) {
        violations++
        fail(
          `js-mssql: ${rel}:${v.line} — не створюй new sql.ConnectionPool(...) на кожен запит; використовуй singleton sql.ConnectionPool: ${v.snippet}`
        )
      }
      for (const v of findUnsafeMssqlQueryTemplateCallInText(content, rel)) {
        unsafeQueryCalls++
        fail(
          `js-mssql: ${rel}:${v.line} — заборонено query(\`...\`): це не tagged template; використовуй pool.request().query\`...\` (js-mssql.mdc): ${v.snippet}`
        )
      }
    }

    if (violations === 0) {
      pass('js-mssql: немає створення new sql.ConnectionPool(...) всередині функцій (singleton pool)')
    }
    if (unsafeQueryCalls === 0) {
      pass('js-mssql: немає небезпечних викликів query(`...`) (потрібно query`...`)')
    }
  }

  return reporter.getExitCode()
}

