/**
 * Перевіряє правило js-bun-db.mdc.
 *
 * 1) У жодному `package.json` (включно з workspace-пакетами) у `dependencies` не повинно
 *    бути `pg` чи `mysql2` — ці бібліотеки треба замінити на Bun native SQL
 *    (`import { sql, SQL } from 'bun'`, https://bun.com/docs/runtime/sql).
 *
 * 2) Якщо в коді використовується Bun SQL (імпорт `sql`/`SQL` з `'bun'`), додатково
 *    перевіряє небезпечні патерни:
 *    - `new SQL(...)` всередині функції (пул має бути singleton на рівні модуля).
 *    - `sql.unsafe(\`...${expr}...\`)` (інтерполяція даних у `unsafe` ламає параметризацію).
 *    - Динамічні SQL-списки через `.join(',')` у `IN (...)` / `VALUES (...)`
 *      (треба `sql([...])`).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import { createCheckReporter } from './utils/check-reporter.mjs'
import {
  findBunSqlPerRequestConnectionInText,
  findUnsafeBunSqlDynamicSqlListInText,
  findUnsafeBunSqlUnsafeCallInText,
  isBunSqlScanSourceFile,
  textHasBunSqlImport
} from './utils/bun-sql-scan.mjs'
import { walkDir } from './utils/walkDir.mjs'

/** Імена забороненої залежності у будь-якому `package.json`. */
const FORBIDDEN_DEPENDENCIES = Object.freeze(['pg', 'mysql2'])

/**
 * @param {unknown} v parsed JSON
 * @returns {Record<string, unknown>} object або {}
 */
function asObject(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  return /** @type {Record<string, unknown>} */ (v)
}

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
 * Збирає абсолютні шляхи JS/TS джерел у репозиторії для скану Bun SQL патернів.
 * @param {string} repoRoot абсолютний шлях до кореня репозиторію
 * @returns {Promise<string[]>} абсолютні шляхи, відсортовані за відносним шляхом
 */
async function findAllSourcePathsForBunSqlScan(repoRoot) {
  /** @type {string[]} */
  const paths = []
  await walkDir(repoRoot, absPath => {
    const rel = relative(repoRoot, absPath).split('\\').join('/')
    if (isBunSqlScanSourceFile(rel)) {
      paths.push(absPath)
    }
  })
  paths.sort((a, b) => relative(repoRoot, a).localeCompare(relative(repoRoot, b)))
  return paths
}

/**
 * Перевіряє, чи в кореневому `package.json` присутні заборонені пакети у `dependencies`.
 * @param {string[]} pkgJsonPaths абсолютні шляхи всіх `package.json` у репо
 * @param {string} repoRoot абсолютний шлях до кореня
 * @param {{ pass: (m: string) => void, fail: (m: string) => void }} reporter колбеки pass і fail з перевірки
 * @returns {Promise<number>} кількість знайдених порушень
 */
async function checkForbiddenDependencies(pkgJsonPaths, repoRoot, reporter) {
  const { pass, fail } = reporter
  let bad = 0
  for (const absPath of pkgJsonPaths) {
    const rel = relative(repoRoot, absPath).split('\\').join('/')
    let parsed
    try {
      parsed = JSON.parse(await readFile(absPath, 'utf8'))
    } catch {
      fail(`js-bun-db: ${rel} — невалідний JSON`)
      bad++
      continue
    }
    const deps = asObject(parsed.dependencies)
    for (const name of FORBIDDEN_DEPENDENCIES) {
      if (Object.hasOwn(deps, name)) {
        bad++
        fail(
          `js-bun-db: ${rel}: dependencies.${name} — замінити на Bun native SQL ` +
            `(import { sql, SQL } from 'bun', https://bun.com/docs/runtime/sql) (js-bun-db.mdc)`
        )
      }
    }
  }
  if (bad === 0) {
    pass(`js-bun-db: жоден package.json не містить ${FORBIDDEN_DEPENDENCIES.join(' / ')} у dependencies`)
  }
  return bad
}

/**
 * Сканує JS/TS-джерела на небезпечні патерни Bun SQL.
 * @param {string[]} sourcePaths абсолютні шляхи джерел
 * @param {string} repoRoot абсолютний шлях до кореня
 * @param {{ pass: (m: string) => void, fail: (m: string) => void }} reporter колбеки pass і fail з перевірки
 * @returns {Promise<{ hasBunSqlImport: boolean, perRequest: number, unsafeCall: number, dynamicList: number }>}
 *   `hasBunSqlImport` — чи знайдено хоч один `import { sql|SQL } from 'bun'` у джерелах;
 *   решта — кількість порушень кожного типу.
 */
async function scanSourcesForBunSqlPatterns(sourcePaths, repoRoot, reporter) {
  const { fail } = reporter
  let hasBunSqlImport = false
  let perRequest = 0
  let unsafeCall = 0
  let dynamicList = 0

  for (const absPath of sourcePaths) {
    const rel = relative(repoRoot, absPath).split('\\').join('/')
    const content = await readFile(absPath, 'utf8')
    if (!hasBunSqlImport && textHasBunSqlImport(content)) {
      hasBunSqlImport = true
    }

    for (const v of findBunSqlPerRequestConnectionInText(content, rel)) {
      perRequest++
      fail(
        `js-bun-db: ${rel}:${v.line} — не створюй new SQL(...) всередині функцій; ` +
          `тримай singleton на рівні модуля (js-bun-db.mdc): ${v.snippet}`
      )
    }
    for (const v of findUnsafeBunSqlUnsafeCallInText(content, rel)) {
      unsafeCall++
      fail(
        `js-bun-db: ${rel}:${v.line} — sql.unsafe(\`...\${...}...\`) недопустимо: ` +
          `використовуй tagged template sql\`...\${value}...\` або sql.unsafe('static', [params]) (js-bun-db.mdc): ${v.snippet}`
      )
    }
    for (const v of findUnsafeBunSqlDynamicSqlListInText(content, rel)) {
      dynamicList++
      fail(
        `js-bun-db: ${rel}:${v.line} — заборонено підставляти у SQL динамічні списки через .join(',') ` +
          `у IN (...) / VALUES (...); використовуй sql([...]) (js-bun-db.mdc): ${v.snippet}`
      )
    }
  }

  return { hasBunSqlImport, perRequest, unsafeCall, dynamicList }
}

/**
 * Перевіряє відповідність проєкту правилу js-bun-db.mdc
 * @returns {Promise<number>} 0 — все OK, 1 — є проблеми
 */
export async function check() {
  const reporter = createCheckReporter()
  const { pass } = reporter

  const repoRoot = process.cwd()
  const rootPkg = join(repoRoot, 'package.json')
  if (!existsSync(rootPkg)) {
    pass('js-bun-db: package.json у корені відсутній — перевірку пропущено')
    return reporter.getExitCode()
  }

  const pkgJsonPaths = await findAllPackageJsonPaths(repoRoot)
  if (pkgJsonPaths.length === 0) {
    pass('js-bun-db: package.json не знайдено — перевірку пропущено')
    return reporter.getExitCode()
  }

  await checkForbiddenDependencies(pkgJsonPaths, repoRoot, reporter)

  const sourcePaths = await findAllSourcePathsForBunSqlScan(repoRoot)
  if (sourcePaths.length === 0) {
    pass('js-bun-db: немає JS/TS файлів для скану патернів Bun SQL')
    return reporter.getExitCode()
  }

  const { hasBunSqlImport, perRequest, unsafeCall, dynamicList } = await scanSourcesForBunSqlPatterns(
    sourcePaths,
    repoRoot,
    reporter
  )

  if (!hasBunSqlImport) {
    pass("js-bun-db: Bun SQL не використовується в коді (немає import { sql|SQL } from 'bun')")
    return reporter.getExitCode()
  }

  if (perRequest === 0) {
    pass('js-bun-db: немає створення new SQL(...) всередині функцій (singleton на рівні модуля)')
  }
  if (unsafeCall === 0) {
    pass('js-bun-db: немає небезпечних викликів sql.unsafe з інтерполяцією в шаблонному рядку')
  }
  if (dynamicList === 0) {
    pass("js-bun-db: немає небезпечних динамічних SQL-списків через .join(',') у IN/VALUES")
  }

  return reporter.getExitCode()
}
