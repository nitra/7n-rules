/** @see ./docs/safety.md */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

import { createViolationReporter } from '../../../scripts/lib/lint-surface/violation-reporter.mjs'
import {
  findBunSqlPerRequestConnectionInText,
  findBunSqlPgLeftoverCallInText,
  findBunSqlUnsafeUseWithoutAllowMarkerInText,
  findBunSqlUnsafeWithInterpolatedTemplateInText,
  findJsonStringifyBeforeJsonbInText,
  findPgFormatLikeQueryWrapperInText,
  findPgFormatShimDefinitionInText,
  findPgLibImportInText,
  findPgListenNotifyUsageInText,
  findSqlArrayWithoutTypeArgInText,
  findUnsafeBunSqlDynamicSqlListInText,
  findUnsafeBunSqlInListMissingEmptyGuardInText,
  isBunSqlScanSourceFile,
  textHasBunSqlImport,
  textHasPgLibImport
} from '../lib/bun-sql-scan.mjs'
import { findAllPackageJsonPaths } from '../../../scripts/utils/find-package-json-paths.mjs'
import { loadCursorIgnorePaths } from '../../../scripts/lib/load-cursor-config.mjs'
import { walkDir } from '../../../scripts/utils/walkDir.mjs'

// Дешеві pre-filter regex'и для AST-сканера LISTEN/NOTIFY: уникаємо парсингу
// файлів, у яких ніяких сигналів немає. Винесено в модульний скоуп, щоб не
// перекомпілювати RegExp на кожному виклику `collectPgUsageForFile`.
const LISTEN_NOTIFY_KEYWORD_RE = /\b(LISTEN|UNLISTEN|NOTIFY)\b/iu
const NOTIFICATION_LITERAL_RE = /['"`]notification['"`]/u

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
 * Сканує JS/TS-джерела на небезпечні патерни Bun SQL і збирає метадані про
 * використання `pg`/LISTEN-NOTIFY (для виключення dependency `pg`).
 * @param {string[]} sourcePaths абсолютні шляхи джерел
 * @param {string} repoRoot абсолютний шлях до кореня
 * @param {{ pass: (m: string) => void, fail: (m: string) => void }} reporter колбеки pass і fail з перевірки
 * @returns {Promise<{
 *   hasBunSqlImport: boolean,
 *   perRequest: number,
 *   unsafeCall: number,
 *   dynamicList: number,
 *   inListGuard: number,
 *   pgLeftover: number,
 *   pgFormatShim: number,
 *   queryWrapper: number,
 *   pgUsage: { rel: string, imports: { line: number, snippet: string }[], listenNotify: { line: number, snippet: string, kind: string }[] }[]
 * }>}
 *   `hasBunSqlImport` — чи є хоч один `import { sql|SQL } from 'bun'`;
 *   `pgUsage` — список файлів, що або імпортують `'pg'`, або містять LISTEN/NOTIFY-патерн
 *   (інші — пропущено, щоб не тримати в пам'яті метадані про всі файли).
 */
async function scanSourcesForBunSqlPatterns(sourcePaths, repoRoot, reporter) {
  const { fail } = reporter
  const counts = {
    perRequest: 0,
    unsafeCall: 0,
    unsafeTemplateInterp: 0,
    dynamicList: 0,
    inListGuard: 0,
    pgLeftover: 0,
    pgFormatShim: 0,
    queryWrapper: 0,
    jsonStringifyJsonb: 0,
    sqlArrayNoType: 0
  }
  let hasBunSqlImport = false
  /** @type {{ rel: string, imports: { line: number, snippet: string }[], listenNotify: { line: number, snippet: string, kind: string }[] }[]} */
  const pgUsage = []

  for (const absPath of sourcePaths) {
    const rel = relative(repoRoot, absPath).split('\\').join('/')
    const content = await readFile(absPath, 'utf8')
    if (!hasBunSqlImport && textHasBunSqlImport(content)) {
      hasBunSqlImport = true
    }
    scanFileForBunSqlPatterns(content, rel, fail, counts)
    collectPgUsageForFile(content, rel, pgUsage)
  }

  return { hasBunSqlImport, pgUsage, ...counts }
}

/**
 * Якщо у файлі є імпорт `'pg'` АБО LISTEN/NOTIFY-патерн — додає запис у `pgUsage`.
 * Файли без жодного сигналу не зберігаються, щоб уникнути зайвої пам'яті.
 * @param {string} content вміст файлу
 * @param {string} rel posix-шлях відносно кореня
 * @param {{ rel: string, imports: { line: number, snippet: string }[], listenNotify: { line: number, snippet: string, kind: string }[] }[]} pgUsage акумулятор
 * @returns {void}
 */
function collectPgUsageForFile(content, rel, pgUsage) {
  // Дешевий pre-filter за текстом: AST-парсинг тільки коли файл містить
  // або імпорт `'pg'`, або хоча б одне зі слів LISTEN / NOTIFY / UNLISTEN /
  // 'notification' — інакше LISTEN/NOTIFY у ньому точно немає.
  const mayHaveListenNotify = LISTEN_NOTIFY_KEYWORD_RE.test(content) || NOTIFICATION_LITERAL_RE.test(content)
  if (!textHasPgLibImport(content) && !mayHaveListenNotify) return
  const imports = findPgLibImportInText(content, rel)
  const listenNotify = findPgListenNotifyUsageInText(content, rel)
  if (imports.length === 0 && listenNotify.length === 0) return
  pgUsage.push({ rel, imports, listenNotify })
}

/**
 * Сканує один файл усіма AST-сканерами bun-sql і реєструє знайдені порушення.
 * @param {string} content вміст файлу
 * @param {string} rel posix-шлях відносно `repoRoot`
 * @param {(msg: string) => void} fail callback при помилці
 * @param {{ perRequest: number, unsafeCall: number, unsafeTemplateInterp: number, dynamicList: number, inListGuard: number, pgLeftover: number, pgFormatShim: number, queryWrapper: number, jsonStringifyJsonb: number, sqlArrayNoType: number }} counts акумулятори
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
  for (const v of findBunSqlUnsafeWithInterpolatedTemplateInText(content, rel)) {
    counts.unsafeTemplateInterp++
    fail(
      `js-bun-db: ${rel}:${v.line} — sql.unsafe(\`...\${x}...\`) з template-літералом і \${...}-інтерполяцією ` +
        `заборонено навіть з allow-unsafe маркером: шаблонна підстановка identifier'у не екранує (reserved words, ` +
        `спецсимволи), а значення не біндяться. Збери text через @scaleleap/pg-format format('%I', name) для ` +
        `identifiers або позиційні $N для values, потім sql.unsafe(text, [params]). Деталі — секція ` +
        `«Динамічна SQL-структура» в js-bun-db.mdc: ${v.snippet}`
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
  for (const v of findJsonStringifyBeforeJsonbInText(content, rel)) {
    counts.jsonStringifyJsonb++
    fail(
      `js-bun-db: ${rel}:${v.line} — JSON.stringify(...) перед ::jsonb зайвий: Bun SQL серіалізує ` +
        `об'єкти/масиви у JSON автоматично, явний stringify призводить до подвійної серіалізації ` +
        `(js-bun-db.mdc query-safety): ${v.snippet}`
    )
  }
  for (const v of findSqlArrayWithoutTypeArgInText(content, rel)) {
    counts.sqlArrayNoType++
    fail(
      `js-bun-db: ${rel}:${v.line} — sql.array(arr) без другого аргументу типу — ` +
        `вкажи явний pg-тип: sql.array(arr, 'int8') / sql.array(arr, 'uuid') тощо ` +
        `(js-bun-db.mdc sql-array): ${v.snippet}`
    )
  }
}

/**
 * Перевіряє виключення `pg` для LISTEN/NOTIFY: по кожному `package.json` з
 * `dependencies.pg` — чи є у проекті хоч одне використання LISTEN/NOTIFY-патерну;
 * додатково — кожен файл з `import 'pg'` повинен сам містити LISTEN/NOTIFY (інакше
 * звичайні SELECT/INSERT/UPDATE через `pg` ховаються за легітимним dependency).
 * @param {string[]} pkgJsonPaths абсолютні шляхи до всіх package.json
 * @param {string} repoRoot абсолютний шлях до кореня
 * @param {{ rel: string, imports: { line: number, snippet: string }[], listenNotify: { line: number, snippet: string, kind: string }[] }[]} pgUsage метадані з scanSourcesForBunSqlPatterns
 * @param {{ fail: (m: string) => void }} reporter колбек fail для повідомлень
 * @returns {Promise<{ pgDepFails: number, pgImportFails: number, pgDepsFound: number, hasAnyListenNotify: boolean, listenNotifyEvidence: string | null }>}
 *   counters і метадані для підсумкового `pass`-повідомлення (де саме знайдено перший LISTEN/NOTIFY).
 */
async function checkPgDependencyAndUsage(pkgJsonPaths, repoRoot, pgUsage, reporter) {
  const { fail } = reporter
  let pgDepFails = 0
  let pgImportFails = 0
  let pgDepsFound = 0

  const firstWithListenNotify = pgUsage.find(u => u.listenNotify.length > 0)
  const hasAnyListenNotify = !!firstWithListenNotify
  const listenNotifyEvidence = firstWithListenNotify
    ? `${firstWithListenNotify.rel}:${firstWithListenNotify.listenNotify[0].line}`
    : null

  for (const absPkgPath of pkgJsonPaths) {
    const relPkg = relative(repoRoot, absPkgPath).split('\\').join('/')
    let pkg
    try {
      pkg = JSON.parse(await readFile(absPkgPath, 'utf8'))
    } catch {
      // невалідний JSON у package.json — це проблема інших правил, тут пропускаємо
      continue
    }
    if (!pkg || typeof pkg !== 'object') continue
    const deps = pkg.dependencies
    if (!deps || typeof deps !== 'object' || !Object.hasOwn(deps, 'pg')) continue
    pgDepsFound++
    if (!hasAnyListenNotify) {
      pgDepFails++
      fail(
        `js-bun-db: ${relPkg}: dependencies.pg заборонено — у проекті не знайдено LISTEN / NOTIFY / UNLISTEN ` +
          `(або listener'а .on('notification', ...)). Bun SQL покриває звичайні запити; ` +
          `\`pg\` дозволений лише як виняток для LISTEN/NOTIFY (js-bun-db.mdc, ` +
          `секція «pg для LISTEN/NOTIFY»)`
      )
    }
  }

  for (const f of pgUsage) {
    if (f.imports.length === 0) continue
    if (f.listenNotify.length > 0) continue
    for (const imp of f.imports) {
      pgImportFails++
      fail(
        `js-bun-db: ${f.rel}:${imp.line} — import 'pg' дозволено лише у файлах з LISTEN / NOTIFY / UNLISTEN ` +
          `або .on('notification', ...). Перенеси звичайні запити на Bun SQL ` +
          `(import { sql } from 'bun'), а LISTEN/NOTIFY-логіку лиши в окремому модулі ` +
          `(js-bun-db.mdc): ${imp.snippet}`
      )
    }
  }

  return { pgDepFails, pgImportFails, pgDepsFound, hasAnyListenNotify, listenNotifyEvidence }
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
 * @param {import('../../../scripts/lib/lint-surface/types.mjs').LintContext} ctx контекст лінту
 * @returns {Promise<import('../../../scripts/lib/lint-surface/types.mjs').LintResult>}
 */
export async function lint(ctx) {
  const cwd = ctx.cwd
  const reporter = createViolationReporter(ctx)
  const { pass } = reporter

  const repoRoot = cwd
  const rootPkg = join(repoRoot, 'package.json')
  if (!existsSync(rootPkg)) {
    pass('js-bun-db: package.json у корені відсутній — перевірку пропущено')
    return reporter.result()
  }

  const ignorePaths = await loadCursorIgnorePaths(repoRoot)
  const pkgJsonPaths = await findAllPackageJsonPaths(repoRoot, ignorePaths)
  if (pkgJsonPaths.length === 0) {
    pass('js-bun-db: package.json не знайдено — перевірку пропущено')
    return reporter.result()
  }

  // Заборону `pg-format` / `mysql2` у `dependencies` тримає Rego-поліс
  // `npm/policy/js_bun_db/package_json/`. `pg` оброблено тут — як виняток для
  // LISTEN/NOTIFY (Rego не бачить JS-коду, тож не може зважити сигнал).

  const sourcePaths = await findAllSourcePathsForBunSqlScan(repoRoot, ignorePaths)
  if (sourcePaths.length === 0) {
    pass('js-bun-db: немає JS/TS файлів для скану патернів Bun SQL')
    return reporter.result()
  }

  const {
    hasBunSqlImport,
    pgUsage,
    perRequest,
    unsafeCall,
    unsafeTemplateInterp,
    dynamicList,
    inListGuard,
    pgLeftover,
    pgFormatShim,
    queryWrapper,
    jsonStringifyJsonb,
    sqlArrayNoType
  } = await scanSourcesForBunSqlPatterns(sourcePaths, repoRoot, reporter)

  const { pgDepFails, pgImportFails, pgDepsFound, listenNotifyEvidence } = await checkPgDependencyAndUsage(
    pkgJsonPaths,
    repoRoot,
    pgUsage,
    reporter
  )
  if (pgDepFails === 0) {
    if (pgDepsFound === 0) {
      pass('js-bun-db: dependencies.pg відсутнє у жодному package.json')
    } else {
      pass(
        `js-bun-db: dependencies.pg виправдано LISTEN/NOTIFY у коді (виключення з js-bun-db.mdc; ` +
          `доказ: ${listenNotifyEvidence})`
      )
    }
  }
  if (pgImportFails === 0) {
    pass("js-bun-db: усі `import 'pg'` або відсутні, або у файлах з LISTEN/NOTIFY")
  }

  if (!hasBunSqlImport) {
    pass("js-bun-db: Bun SQL не використовується в коді (немає import { sql|SQL } from 'bun')")
    return reporter.result()
  }

  if (perRequest === 0) {
    pass('js-bun-db: немає створення new SQL(...) всередині функцій (singleton на рівні модуля)')
  }
  if (unsafeCall === 0) {
    pass('js-bun-db: усі sql.unsafe(...) або відсутні, або супроводжуються маркером "// allow-unsafe: <причина>"')
  }
  if (unsafeTemplateInterp === 0) {
    pass(
      'js-bun-db: немає sql.unsafe(template literal з інтерполяцією) ' +
        '(identifiers через @scaleleap/pg-format %I, values — позиційні $N)'
    )
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
  if (jsonStringifyJsonb === 0) {
    pass('js-bun-db: немає JSON.stringify(...) перед ::jsonb — Bun SQL серіалізує автоматично')
  }
  if (sqlArrayNoType === 0) {
    pass('js-bun-db: усі sql.array() мають явний аргумент типу')
  }

  return reporter.result()
}
