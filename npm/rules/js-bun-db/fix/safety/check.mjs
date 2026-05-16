/**
 * Перевіряє правило js-bun-db.mdc.
 *
 * 1) У жодному `package.json` (включно з workspace-пакетами) у `dependencies` не повинно
 *    бути `pg`, `pg-format` чи `mysql2` — ці бібліотеки треба замінити на Bun native SQL
 *    (`import { sql, SQL } from 'bun'`, https://bun.com/docs/runtime/sql).
 *    `pg-format` — ручне форматування SQL через escape; tagged template Bun SQL
 *    параметризує значення нативно і не лишає простору для injection.
 *
 * 2) Якщо в коді використовується Bun SQL (імпорт `sql`/`SQL` з `'bun'`), додатково
 *    перевіряє небезпечні патерни:
 *    - `new SQL(...)` всередині функції (пул має бути singleton на рівні модуля).
 *    - Будь-який `<obj>.unsafe(...)` без маркера-коментаря `// allow-unsafe: <reason>`
 *      на тому ж рядку або рядком вище. `sql.unsafe` за замовчуванням заборонено;
 *      допустимий лише для підстановки назви таблиці/колонки чи dynamic SQL/DDL,
 *      коли значення контролюється кодом (не user input) — в інших випадках
 *      переробляємо на tagged template `sql\`...\${value}...\``.
 *    - pg-leftover виклики `<obj>.connect(...)` / `<obj>.end(...)` у файлах, що
 *      імпортують Bun SQL: пулом керує Bun, життєвий цикл вручну не потрібен.
 *      Opt-out — маркер `// allow-pg-leftover: <reason>`.
 *    - Динамічні SQL-списки через `.join(',')` у `IN (...)` / `VALUES (...)`
 *      (треба `sql([...])`).
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { createCheckReporter } from '../../../../scripts/utils/check-reporter.mjs'
import {
  findBunSqlPerRequestConnectionInText,
  findBunSqlPgLeftoverCallInText,
  findBunSqlUnsafeUseWithoutAllowMarkerInText,
  findPgFormatLikeQueryWrapperInText,
  findPgFormatShimDefinitionInText,
  findUnsafeBunSqlDynamicSqlListInText,
  findUnsafeBunSqlInListMissingEmptyGuardInText,
  isBunSqlScanSourceFile,
  textHasBunSqlImport
} from '../../../../scripts/utils/bun-sql-scan.mjs'
import { findAllPackageJsonPaths } from '../../../../scripts/utils/find-package-json-paths.mjs'
import { loadCursorIgnorePaths } from '../../../../scripts/utils/load-cursor-config.mjs'
import { walkDir } from '../../../../scripts/utils/walkDir.mjs'

/**
 * Збирає абсолютні шляхи JS/TS джерел у репозиторії для скану Bun SQL патернів.
 * @param {string} repoRoot абсолютний шлях до кореня репозиторію
 * @param {string[]} ignorePaths абсолютні шляхи каталогів, повністю виключених з обходу
 * @returns {Promise<string[]>} абсолютні шляхи, відсортовані за відносним шляхом
 */
async function findAllSourcePathsForBunSqlScan(repoRoot, ignorePaths) {
  /** @type {string[]} */
  const paths = []
  await walkDir(
    repoRoot,
    absPath => {
      const rel = relative(repoRoot, absPath).split('\\').join('/')
      if (isBunSqlScanSourceFile(rel)) {
        paths.push(absPath)
      }
    },
    ignorePaths
  )
  paths.sort((a, b) => relative(repoRoot, a).localeCompare(relative(repoRoot, b)))
  return paths
}

/**
 * Сканує JS/TS-джерела на небезпечні патерни Bun SQL.
 * @param {string[]} sourcePaths абсолютні шляхи джерел
 * @param {string} repoRoot абсолютний шлях до кореня
 * @param {{ pass: (m: string) => void, fail: (m: string) => void }} reporter колбеки pass і fail з перевірки
 * @returns {Promise<{ hasBunSqlImport: boolean, perRequest: number, unsafeCall: number, dynamicList: number, inListGuard: number, pgLeftover: number, pgFormatShim: number, queryWrapper: number }>}
 *   `hasBunSqlImport` — чи знайдено хоч один `import { sql|SQL } from 'bun'` у джерелах;
 *   решта — кількість порушень кожного типу.
 */
async function scanSourcesForBunSqlPatterns(sourcePaths, repoRoot, reporter) {
  const { fail } = reporter
  const counts = {
    perRequest: 0,
    unsafeCall: 0,
    dynamicList: 0,
    inListGuard: 0,
    pgLeftover: 0,
    pgFormatShim: 0,
    queryWrapper: 0
  }
  let hasBunSqlImport = false

  for (const absPath of sourcePaths) {
    const rel = relative(repoRoot, absPath).split('\\').join('/')
    const content = await readFile(absPath, 'utf8')
    if (!hasBunSqlImport && textHasBunSqlImport(content)) {
      hasBunSqlImport = true
    }
    scanFileForBunSqlPatterns(content, rel, fail, counts)
  }

  return { hasBunSqlImport, ...counts }
}

/**
 * Сканує один файл усіма AST-сканерами bun-sql і реєструє знайдені порушення.
 * @param {string} content вміст файлу
 * @param {string} rel posix-шлях відносно `repoRoot`
 * @param {(msg: string) => void} fail callback при помилці
 * @param {{ perRequest: number, unsafeCall: number, dynamicList: number, inListGuard: number, pgLeftover: number, pgFormatShim: number, queryWrapper: number }} counts акумулятори
 * @returns {void}
 */
function scanFileForBunSqlPatterns(content, rel, fail, counts) {
  for (const v of findBunSqlPerRequestConnectionInText(content, rel)) {
    counts.perRequest++
    fail(
      `js-bun-db: ${rel}:${v.line} — не створюй new SQL(...) всередині функцій; ` +
        `тримай singleton на рівні модуля (js-bun-db.mdc): ${v.snippet}`
    )
  }
  for (const v of findBunSqlUnsafeUseWithoutAllowMarkerInText(content, rel)) {
    counts.unsafeCall++
    fail(
      `js-bun-db: ${rel}:${v.line} — sql.unsafe(...) заборонено за замовчуванням; ` +
        `допустимо лише для підстановки назви таблиці/колонки чи dynamic SQL/DDL з code-controlled значенням, ` +
        `інакше переробити на tagged template sql\`...\${value}...\`. ` +
        `Якщо випадок легітимний — додай маркер "// allow-unsafe: <причина>" на тому ж рядку або рядком вище ` +
        `(js-bun-db.mdc): ${v.snippet}`
    )
  }
  for (const v of findBunSqlPgLeftoverCallInText(content, rel)) {
    counts.pgLeftover++
    fail(
      `js-bun-db: ${rel}:${v.line} — pg-leftover виклик .${v.methodName}(...): Bun SQL пулом керує сам, ` +
        `видали зайвий .connect()/.end() або, якщо випадок легітимний (graceful shutdown тощо), ` +
        `додай маркер "// allow-pg-leftover: <причина>" на тому ж рядку або рядком вище ` +
        `(js-bun-db.mdc): ${v.snippet}`
    )
  }
  for (const v of findUnsafeBunSqlDynamicSqlListInText(content, rel)) {
    counts.dynamicList++
    fail(
      `js-bun-db: ${rel}:${v.line} — заборонено підставляти у SQL динамічні списки через .join(',') ` +
        `у IN (...) / VALUES (...); використовуй sql([...]) (js-bun-db.mdc): ${v.snippet}`
    )
  }
  for (const v of findUnsafeBunSqlInListMissingEmptyGuardInText(content, rel)) {
    counts.inListGuard++
    fail(messageForBunSqlInListGuard(rel, v))
  }
  for (const v of findPgFormatShimDefinitionInText(content, rel)) {
    counts.pgFormatShim++
    if (v.kind === 'format_function') {
      fail(
        `js-bun-db: ${rel}:${v.line} — функція ${JSON.stringify(v.name)} виглядає як pg-format-сумісний шим ` +
          `(тіло містить %L / %I / %s). Видали шим і переведи всі call-site на tagged template ` +
          `sql\`...\${value}...\` (js-bun-db.mdc): ${v.snippet}`
      )
    } else {
      fail(
        `js-bun-db: ${rel}:${v.line} — ${JSON.stringify(v.name)} — це pg-format-специфічний escape-хелпер; ` +
          `з Bun SQL він не потрібен (параметризація через tagged template), видали і перепиши call-site ` +
          `(js-bun-db.mdc): ${v.snippet}`
      )
    }
  }
  for (const v of findPgFormatLikeQueryWrapperInText(content, rel)) {
    counts.queryWrapper++
    fail(
      `js-bun-db: ${rel}:${v.line} — query(text, params)-обгортка над <obj>.unsafe(...) — це прихований ` +
        `pg-сумісний шим. Видали обгортку (pgRead/pgWrite/db.query) і переведи всі call-site на tagged template ` +
        `sql\`...\${value}...\` (js-bun-db.mdc): ${v.snippet}`
    )
  }
}

/**
 * Будує повідомлення `fail` для порушення `findUnsafeBunSqlInListMissingEmptyGuardInText`
 * залежно від `reason` (різні діагностики однакового сімейства).
 * @param {string} rel posix-шлях відносно кореня репо
 * @param {{ line: number, snippet: string, name?: string, reason: string }} v порушення
 * @returns {string} готове повідомлення для `fail`
 */
function messageForBunSqlInListGuard(rel, v) {
  if (v.reason === 'missing_guard') {
    return (
      `js-bun-db: ${rel}:${v.line} — перед IN-списком ${JSON.stringify(v.name)} потрібна перевірка на пустоту ` +
      `з throw (наприклад if (!${v.name}.length) throw ...), інакше можливі некоректні запити (js-bun-db.mdc): ${v.snippet}`
    )
  }
  if (v.reason === 'sql_helper_not_var') {
    return (
      `js-bun-db: ${rel}:${v.line} — IN-список у \${sql(...)} має підставлятись зі змінної (Identifier) ` +
      `після валідації на пустоту + throw (js-bun-db.mdc): ${v.snippet}`
    )
  }
  return (
    `js-bun-db: ${rel}:${v.line} — значення для IN (...) у template literal треба винести в окрему змінну ` +
    `і перевірити на пустоту (throw), не підставляти вираз напряму (js-bun-db.mdc): ${v.snippet}`
  )
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

  const ignorePaths = await loadCursorIgnorePaths(repoRoot)
  const pkgJsonPaths = await findAllPackageJsonPaths(repoRoot, ignorePaths)
  if (pkgJsonPaths.length === 0) {
    pass('js-bun-db: package.json не знайдено — перевірку пропущено')
    return reporter.getExitCode()
  }

  // Перевірку `dependencies` (заборона `pg` / `pg-format` / `mysql2`) перенесено
  // в Rego-полісі `npm/policy/js_bun_db/package_json/`; `npx @nitra/cursor check`
  // запускає її по всіх workspace-`package.json`. Тут лишився лише AST-скан коду.

  const sourcePaths = await findAllSourcePathsForBunSqlScan(repoRoot, ignorePaths)
  if (sourcePaths.length === 0) {
    pass('js-bun-db: немає JS/TS файлів для скану патернів Bun SQL')
    return reporter.getExitCode()
  }

  const { hasBunSqlImport, perRequest, unsafeCall, dynamicList, inListGuard, pgLeftover, pgFormatShim, queryWrapper } =
    await scanSourcesForBunSqlPatterns(sourcePaths, repoRoot, reporter)

  if (!hasBunSqlImport) {
    pass("js-bun-db: Bun SQL не використовується в коді (немає import { sql|SQL } from 'bun')")
    return reporter.getExitCode()
  }

  if (perRequest === 0) {
    pass('js-bun-db: немає створення new SQL(...) всередині функцій (singleton на рівні модуля)')
  }
  if (unsafeCall === 0) {
    pass('js-bun-db: усі sql.unsafe(...) або відсутні, або супроводжуються маркером "// allow-unsafe: <причина>"')
  }
  if (pgLeftover === 0) {
    pass(
      'js-bun-db: немає pg-leftover викликів .connect()/.end() у файлах з Bun SQL ' +
        '(або всі вони мають маркер "// allow-pg-leftover: <причина>")'
    )
  }
  if (dynamicList === 0) {
    pass("js-bun-db: немає небезпечних динамічних SQL-списків через .join(',') у IN/VALUES")
  }
  if (inListGuard === 0) {
    pass('js-bun-db: усі IN-списки винесені у змінні та мають перевірку на пустоту з throw')
  }
  if (pgFormatShim === 0) {
    pass('js-bun-db: немає pg-format-сумісних шимів (format/quoteLiteral/quoteIdent/...) у файлах з Bun SQL')
  }
  if (queryWrapper === 0) {
    pass('js-bun-db: немає query(text, params)-обгорток над unsafe(...) у файлах з Bun SQL')
  }

  return reporter.getExitCode()
}
