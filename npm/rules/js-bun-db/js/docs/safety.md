# `safety.mjs` — перевірка правила `js-bun-db.mdc`

## Огляд

Модуль `npm/rules/js-bun-db/js/safety.mjs` — основний JS-чекер правила `js-bun-db.mdc`. Його завдання — обійти репозиторій і переконатися, що проєкт використовує **Bun native SQL** (`import { sql, SQL } from 'bun'`) замість застарілих PostgreSQL/MySQL клієнтів, та що Bun SQL використовується безпечно.

Чекер виконує три великі групи перевірок:

1. **Заборона `pg-format` / `mysql2`** у `dependencies` будь-якого `package.json`. Цю частину закриває окремий Rego-поліс у `npm/policy/js_bun_db/package_json/` — `safety.mjs` лише довіряє йому й не дублює перевірку.
2. **Виключення для `pg`** — dependency `pg` дозволено тільки тоді, коли в коді справді використовується `LISTEN` / `NOTIFY` / `UNLISTEN` або listener `.on('notification', ...)` (Bun SQL поки не покриває LISTEN/NOTIFY). Перевірка йде на двох рівнях: на рівні кожного `package.json` (якщо в проекті взагалі немає LISTEN/NOTIFY — `pg` забороняється) і per-file (файл з `import 'pg'` сам має містити LISTEN/NOTIFY-патерн).
3. **Безпечне використання Bun SQL** у файлах з `import { sql|SQL } from 'bun'`. Сюди входять перевірки на `new SQL(...)` у функції (має бути модульний singleton), `sql.unsafe(...)` без маркера-коментаря `// allow-unsafe: <reason>`, динамічні `.join(',')` у `IN (...)` / `VALUES (...)`, IN-списки без guard на пустоту, pg-format-сумісні шими (`format` / `quoteLiteral` / `quoteIdent`) і `query(text, params)`-обгортки над `<obj>.unsafe(...)`.

Усі знайдені порушення повідомляються через `createCheckReporter()` як `fail`, а кожна «чиста» категорія дає окремий `pass`. Підсумкове значення — `0` (все чисто) або `1` (є порушення) — повертає функція `check`.

## Експорти / API

| Експорт       | Тип              | Призначення                                                                                          |
| ------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| `check(cwd?)` | `async function` | Публічна точка входу. Виконує всі перевірки правила `js-bun-db.mdc` і повертає exit-код (`0` / `1`). |

Решта функцій (`findAllSourcePathsForBunSqlScan`, `scanSourcesForBunSqlPatterns`, `collectPgUsageForFile`, `scanFileForBunSqlPatterns`, `checkPgDependencyAndUsage`, `messageForBunSqlInListGuard`) — внутрішні; з модуля не експортуються.

Константи модульного скоупу (теж не експортуються):

- `LISTEN_NOTIFY_KEYWORD_RE` — `/\b(LISTEN|UNLISTEN|NOTIFY)\b/iu`. Дешевий pre-filter regex для пошуку SQL-ключових слів.
- `NOTIFICATION_LITERAL_RE` — `/['"`]notification['"`]/u`. Дешевий pre-filter regex для рядкового літерала `'notification'`(як ім'я події в`.on('notification', ...)`).

Обидві винесені у модульний скоуп, щоб не перекомпілювати `RegExp` на кожен виклик `collectPgUsageForFile`.

## Функції

### `findAllSourcePathsForBunSqlScan(repoRoot, ignorePaths)`

- **Сигнатура:** `async function findAllSourcePathsForBunSqlScan(repoRoot: string, ignorePaths: string[]): Promise<string[]>`
- **Параметри:**
  - `repoRoot` — абсолютний шлях до кореня репозиторію.
  - `ignorePaths` — масив абсолютних шляхів каталогів, які повністю виключаються з обходу (звичайно отримується з `loadCursorIgnorePaths`).
- **Повертає:** масив абсолютних шляхів файлів, що проходять `isBunSqlScanSourceFile(rel)`, відсортований за відносним posix-шляхом (через `localeCompare`).
- **Side effects:** виключно читання директорій через `walkDir`; нічого не пише.
- **Деталі:** використовує `walkDir` із зовнішнього колбека: для кожного знайденого `absPath` обчислює відносний шлях, нормалізує windows-роздільники (`\\` → `/`) і викликає `isBunSqlScanSourceFile`. Сортування потрібне, щоб порядок повідомлень про порушення був детермінованим.

### `scanSourcesForBunSqlPatterns(sourcePaths, repoRoot, reporter)`

- **Сигнатура:** `async function scanSourcesForBunSqlPatterns(sourcePaths: string[], repoRoot: string, reporter: { pass: (m: string) => void, fail: (m: string) => void }): Promise<{ hasBunSqlImport: boolean, perRequest: number, unsafeCall: number, unsafeTemplateInterp: number, dynamicList: number, inListGuard: number, pgLeftover: number, pgFormatShim: number, queryWrapper: number, pgUsage: Array<{ rel: string, imports: { line: number, snippet: string }[], listenNotify: { line: number, snippet: string, kind: string }[] }> }>`
- **Параметри:**
  - `sourcePaths` — абсолютні шляхи джерел, відібраних `findAllSourcePathsForBunSqlScan`.
  - `repoRoot` — абсолютний шлях до кореня.
  - `reporter` — обʼєкт з `pass`/`fail` (тут використовується лише `fail`).
- **Повертає:** обʼєкт з прапором `hasBunSqlImport`, лічильниками порушень за категоріями (`perRequest`, `unsafeCall`, `unsafeTemplateInterp`, `dynamicList`, `inListGuard`, `pgLeftover`, `pgFormatShim`, `queryWrapper`) та масивом `pgUsage` (тільки файли з імпортом `'pg'` або LISTEN/NOTIFY-патерном).
- **Side effects:** читає файли через `readFile`; викликає `fail(...)` для кожного порушення (через `scanFileForBunSqlPatterns`).
- **Деталі:** проходить по всіх файлах послідовно (`for ... of`), щоб не створювати лавину паралельних `readFile`. Прапор `hasBunSqlImport` встановлюється тільки один раз — після першого знайденого `import { sql|SQL } from 'bun'`. У повернутому обʼєкті лічильник `unsafeTemplateInterp` присутній фактично, хоча у JSDoc-типі формально не задекларований (важлива деталь для подальшого використання у `check`).

### `collectPgUsageForFile(content, rel, pgUsage)`

- **Сигнатура:** `function collectPgUsageForFile(content: string, rel: string, pgUsage: Array<{ rel, imports, listenNotify }>): void`
- **Параметри:**
  - `content` — повний вміст файлу.
  - `rel` — posix-шлях відносно кореня репо.
  - `pgUsage` — масив-акумулятор (мутується in place).
- **Повертає:** нічого.
- **Side effects:** мутує `pgUsage` через `push`.
- **Деталі:**
  1. Дешевий текстовий pre-filter: `mayHaveListenNotify = LISTEN_NOTIFY_KEYWORD_RE.test(content) || NOTIFICATION_LITERAL_RE.test(content)`.
  2. Якщо файл не імпортує `'pg'` І не пройшов pre-filter — швидкий `return` (AST не парситься).
  3. Інакше викликаються AST-сканери `findPgLibImportInText` і `findPgListenNotifyUsageInText`.
  4. Якщо обидва пусті — запис не додається.
  5. Інакше у `pgUsage` пушиться `{ rel, imports, listenNotify }`.

Логіка економить памʼять (не зберігаються метадані файлів без сигналу) і CPU (AST не парситься для файлів без жодного зі слів LISTEN / NOTIFY / UNLISTEN / `'notification'` і без імпорту `'pg'`).

### `scanFileForBunSqlPatterns(content, rel, fail, counts)`

- **Сигнатура:** `function scanFileForBunSqlPatterns(content: string, rel: string, fail: (msg: string) => void, counts: { perRequest, unsafeCall, unsafeTemplateInterp, dynamicList, inListGuard, pgLeftover, pgFormatShim, queryWrapper }): void`
- **Параметри:**
  - `content` — вміст файлу.
  - `rel` — posix-шлях відносно `repoRoot`.
  - `fail` — колбек з reporter'а для запису повідомлень про порушення.
  - `counts` — обʼєкт-акумулятор лічильників (мутується).
- **Повертає:** нічого.
- **Side effects:** інкрементує лічильники `counts.*` та викликає `fail(...)` для кожного знайденого порушення.
- **Деталі:** запускає по черзі сімейство сканерів з `bun-sql-scan.mjs`:

  | Сканер                                           | Лічильник              | Тип порушення                                                                                                         |
  | ------------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
  | `findBunSqlPerRequestConnectionInText`           | `perRequest`           | `new SQL(...)` всередині функції — має бути модульний singleton.                                                      |
  | `findBunSqlUnsafeUseWithoutAllowMarkerInText`    | `unsafeCall`           | `<obj>.unsafe(...)` без маркера `// allow-unsafe: <reason>` на тому ж/попередньому рядку.                             |
  | `findBunSqlUnsafeWithInterpolatedTemplateInText` | `unsafeTemplateInterp` | `sql.unsafe(\`...\${x}...\`)` з template-літералом + інтерполяцією (заборонено навіть з allow-маркером).              |
  | `findBunSqlPgLeftoverCallInText`                 | `pgLeftover`           | `<obj>.connect(...)` / `<obj>.end(...)` у файлах з Bun SQL (Bun сам керує пулом).                                     |
  | `findUnsafeBunSqlDynamicSqlListInText`           | `dynamicList`          | Динамічний список через `.join(',')` у `IN (...)` / `VALUES (...)`.                                                   |
  | `findUnsafeBunSqlInListMissingEmptyGuardInText`  | `inListGuard`          | IN-список без перевірки на пустоту з `throw` — повідомлення формує `messageForBunSqlInListGuard`.                     |
  | `findPgFormatShimDefinitionInText`               | `pgFormatShim`         | Локальне визначення pg-format-сумісного шиму (`format` з `%L` / `%I` / `%s`, або `quoteLiteral` / `quoteIdent` тощо). |
  | `findPgFormatLikeQueryWrapperInText`             | `queryWrapper`         | `query(text, params)` обгортка над `<obj>.unsafe(...)` — прихований pg-сумісний шим.                                  |

  Кожне повідомлення містить шлях, номер рядка, людський опис проблеми, посилання на правило `js-bun-db.mdc` і сам snippet порушення. Для `findPgFormatShimDefinitionInText` повідомлення розгалужується за `v.kind === 'format_function'` (повна функція з форматерами) vs інше (escape-хелпер на кшталт `quoteLiteral`).

### `checkPgDependencyAndUsage(pkgJsonPaths, repoRoot, pgUsage, reporter)`

- **Сигнатура:** `async function checkPgDependencyAndUsage(pkgJsonPaths: string[], repoRoot: string, pgUsage: Array<{ rel, imports, listenNotify }>, reporter: { fail: (m: string) => void }): Promise<{ pgDepFails: number, pgImportFails: number, pgDepsFound: number, hasAnyListenNotify: boolean, listenNotifyEvidence: string | null }>`
- **Параметри:**
  - `pkgJsonPaths` — абсолютні шляхи всіх знайдених `package.json`.
  - `repoRoot` — корінь репозиторію.
  - `pgUsage` — метадані з `scanSourcesForBunSqlPatterns`.
  - `reporter` — обʼєкт з `fail`.
- **Повертає:** обʼєкт зі статистикою:
  - `pgDepFails` — скільки `package.json` мають `dependencies.pg` без підтвердженого LISTEN/NOTIFY у проекті.
  - `pgImportFails` — скільки окремих файлів-імпортів `'pg'` не мають власного LISTEN/NOTIFY.
  - `pgDepsFound` — скільки `package.json` оголошують `dependencies.pg` (для `pass`-повідомлення про виключення).
  - `hasAnyListenNotify` — чи хоч десь у проекті є LISTEN/NOTIFY.
  - `listenNotifyEvidence` — рядок виду `"<rel>:<line>"` — перший доказ LISTEN/NOTIFY (або `null`).
- **Side effects:** читає `package.json` через `readFile`; викликає `reporter.fail(...)` за кожне порушення.
- **Деталі:**
  1. Спочатку шукає у `pgUsage` перший файл з непустим `listenNotify` (`firstWithListenNotify`) — фіксується доказ (`<rel>:<firstLine>`).
  2. Цикл по `pkgJsonPaths`: парсить кожен `package.json` (`JSON.parse`), на невалідному — `continue` (це проблема інших правил). Якщо немає `dependencies.pg` — пропускає. Інакше інкрементує `pgDepsFound` і, якщо у проекті немає LISTEN/NOTIFY взагалі, інкрементує `pgDepFails` та пише `fail` про заборону `dependencies.pg`.
  3. Цикл по `pgUsage`: для кожного файлу з імпортом `'pg'`, але без LISTEN/NOTIFY — інкрементує `pgImportFails` і пише `fail` по кожному імпорту окремо.

### `messageForBunSqlInListGuard(rel, v)`

- **Сигнатура:** `function messageForBunSqlInListGuard(rel: string, v: { line: number, snippet: string, name?: string, reason: string }): string`
- **Параметри:**
  - `rel` — posix-шлях файлу.
  - `v` — обʼєкт порушення від `findUnsafeBunSqlInListMissingEmptyGuardInText`: містить `line`, `snippet`, опційне `name` (ідентифікатор змінної) і `reason` (підвид діагностики).
- **Повертає:** готовий рядок-повідомлення для `fail`.
- **Side effects:** немає; чиста функція.
- **Деталі:** діагностика розгалужується за `v.reason`:
  - `'missing_guard'` — змінна-IN не має перевірки на пустоту з `throw`.
  - `'sql_helper_not_var'` — у `${sql(...)}` всередині IN-списку має бути Identifier (а не вираз/виклик).
  - інакше (default) — значення IN-списку у template literal треба винести в окрему змінну, валідувати на пустоту і кинути `throw` замість прямої підстановки.

### `check(cwd?)`

- **Сигнатура:** `export async function check(cwd: string = process.cwd()): Promise<number>`
- **Параметри:**
  - `cwd` — корінь репозиторію; за замовчуванням `process.cwd()`.
- **Повертає:** `0`, якщо порушень не знайдено; `1` — інакше. Точне значення обчислює `reporter.getExitCode()`.
- **Side effects:** читання файлів (`existsSync`, `readFile`, `walkDir`); виклики `reporter.pass(...)` / `reporter.fail(...)` (у дефолтній імплементації — друкують у консоль).
- **Деталі (порядок виконання):**
  1. Створює reporter через `createCheckReporter()`; деструктурує `{ pass }`.
  2. Перевіряє існування `package.json` у корені. Якщо немає — `pass('js-bun-db: package.json у корені відсутній — перевірку пропущено')` і ранній вихід.
  3. Підвантажує `ignorePaths` через `loadCursorIgnorePaths(repoRoot)` (читає `.cursorignore` тощо).
  4. Шукає всі `package.json` у репо (`findAllPackageJsonPaths`). Якщо нічого — `pass(...)` і вихід.
  5. Збирає всі JS/TS-джерела для скану (`findAllSourcePathsForBunSqlScan`). Якщо нічого — `pass(...)` і вихід.
  6. Сканує всі джерела (`scanSourcesForBunSqlPatterns`) і отримує лічильники + `pgUsage` + `hasBunSqlImport`.
  7. Перевіряє dependency `pg` і per-file імпорти (`checkPgDependencyAndUsage`). На основі `pgDepFails === 0` / `pgImportFails === 0` пише відповідні `pass`-повідомлення (з різним текстом залежно від `pgDepsFound`).
  8. Якщо `hasBunSqlImport === false` — `pass('Bun SQL не використовується в коді')` і ранній вихід (немає сенсу скаржитися на патерни Bun SQL у проекті, що ним не користується).
  9. Інакше для кожної категорії з `count === 0` пише позитивний `pass` (`new SQL` singleton, `sql.unsafe` маркерована, `unsafeTemplateInterp`, pg-leftover, dynamic list, in-list guard, pg-format шими, query-обгортки).
  10. Повертає `reporter.getExitCode()`.

## Залежності

Зовнішні (Node.js core):

- `node:fs` → `existsSync` — перевірка наявності кореневого `package.json`.
- `node:fs/promises` → `readFile` — асинхронне читання файлів.
- `node:path` → `join`, `relative` — побудова шляхів і обчислення відносних.

Внутрішні модулі репозиторію:

- `../../../scripts/lib/check-reporter.mjs` → `createCheckReporter` — фабрика reporter'а з `pass` / `fail` / `getExitCode`.
- `../lib/bun-sql-scan.mjs` — набір AST-сканерів і дешевих текстових пре-фільтрів:
  - `findBunSqlPerRequestConnectionInText`
  - `findBunSqlPgLeftoverCallInText`
  - `findBunSqlUnsafeUseWithoutAllowMarkerInText`
  - `findBunSqlUnsafeWithInterpolatedTemplateInText`
  - `findPgFormatLikeQueryWrapperInText`
  - `findPgFormatShimDefinitionInText`
  - `findPgLibImportInText`
  - `findPgListenNotifyUsageInText`
  - `findUnsafeBunSqlDynamicSqlListInText`
  - `findUnsafeBunSqlInListMissingEmptyGuardInText`
  - `isBunSqlScanSourceFile` — фільтр шляхів (які файли скануються взагалі).
  - `textHasBunSqlImport` — швидкий текстовий тест на наявність `import { sql|SQL } from 'bun'`.
  - `textHasPgLibImport` — швидкий текстовий тест на наявність `import ... from 'pg'`.
- `../../../scripts/utils/find-package-json-paths.mjs` → `findAllPackageJsonPaths` — обхід репо і збір усіх `package.json` (з урахуванням ignore-паттернів).
- `../../../scripts/lib/load-cursor-config.mjs` → `loadCursorIgnorePaths` — список абсолютних шляхів, виключених з обходу (на основі конфігу Cursor).
- `../../../scripts/utils/walkDir.mjs` → `walkDir` — рекурсивний обхід каталогу з підтримкою ignore-list.

Покладається на наявність ESM, `bun`/`node` runtime з підтримкою top-level `process.cwd()`.

## Потік виконання / Використання

### Імпорт як бібліотека

```js
import { check } from './safety.mjs'

const exitCode = await check(process.cwd())
process.exit(exitCode)
```

### Запуск у складі checker-пайплайна

Функція `check(cwd)` — це стандартний контракт правил `npm/rules/<rule-id>/js/safety.mjs` у репозиторії. Зовнішній runner викликає її, отримує `0` / `1` і за потреби агрегує з іншими правилами.

### Логічний потік `check`

```
check(cwd)
  ├── existsSync(<cwd>/package.json)?       // ні → pass + exit
  ├── loadCursorIgnorePaths(repoRoot)
  ├── findAllPackageJsonPaths(...)          // 0 → pass + exit
  ├── findAllSourcePathsForBunSqlScan(...)  // 0 → pass + exit
  ├── scanSourcesForBunSqlPatterns(...)
  │     для кожного файлу:
  │       ├── textHasBunSqlImport → встановити hasBunSqlImport
  │       ├── scanFileForBunSqlPatterns → 8 сканерів, fail + counts
  │       └── collectPgUsageForFile → текст-prefilter → AST → push pgUsage
  ├── checkPgDependencyAndUsage(...)
  │     ├── знайти firstWithListenNotify → listenNotifyEvidence
  │     ├── по кожному package.json з dependencies.pg → fail якщо нема LISTEN/NOTIFY
  │     └── по кожному файлу з import 'pg' без LISTEN/NOTIFY → fail
  ├── pass-повідомлення про pg (залежно від pgDepsFound / listenNotifyEvidence)
  ├── якщо !hasBunSqlImport → pass + exit
  └── pass для кожної категорії з count === 0
        (perRequest, unsafeCall, unsafeTemplateInterp,
         pgLeftover, dynamicList, inListGuard,
         pgFormatShim, queryWrapper)
  └── return reporter.getExitCode()
```

### Як інтерпретувати вивід

- Кожне порушення друкується через `fail(...)` з префіксом `js-bun-db:`, шляхом `<rel>:<line>`, описом і snippet.
- Кожна чиста категорія дає `pass(...)` — це корисно для логів CI, щоб бачити, що перевірка не «мовчки» пропущена.
- Exit-код `0` гарантує, що жоден `fail` не був викликаний; `1` — є щонайменше один.

### Сценарії раннього виходу

- Корінь без `package.json` — нічого перевіряти.
- `package.json` не знайдено взагалі — те саме.
- Немає файлів для скану (`isBunSqlScanSourceFile` повернув `false` для всіх) — Bun SQL-патерни ніде шукати.
- У жодному файлі немає `import { sql|SQL } from 'bun'` — у проекті немає Bun SQL, тож перевірки на `new SQL`, `unsafe`, IN-списки тощо нерелевантні. Перевірка `pg`-dependency при цьому виконується завжди (до цього раннього виходу), бо її цінність не залежить від Bun SQL.
