---
docgen:
  source: npm/rules/js-bun-db/lib/bun-sql-scan.mjs
  crc: 990f04d7
---

# bun-sql-scan.mjs

## Огляд

Модуль `bun-sql-scan.mjs` — це AST-сканер небезпечних патернів використання Bun SQL у JavaScript/TypeScript-коді. Він є частиною npm-правила `js-bun-db` (тека `npm/rules/js-bun-db/lib/`) і реалізує семантичний аналіз коду через парсер **oxc-parser** (без regex-сканування по сирому тексту, за винятком дешевих pre-filter-ів на наявність імпорту).

Призначення сканера — знаходити у файлах, що імпортують `sql`/`SQL` з пакета `bun`, ситуації, які можуть призвести до SQL-injection, антипатернів продуктивності або «недомігрованого» коду з PostgreSQL-клієнта `pg`. Кожна публічна функція пошуку повертає список знахідок із номером рядка та snippet'ом коду — для подальшого перетворення на `fail`-повідомлення у відповідному `.mdc`-правилі.

Загальні принципи:

- **Семантика через AST**, не regex. Regex використовуються лише для дешевих текстових pre-filter'ів (`textHasBunSqlImport`, `textHasPgLibImport`), маркерів-коментарів та коротких підрядків (LISTEN/NOTIFY, pg-format placeholders).
- **Контракт обробки помилок**: якщо файл не парситься (`parseProgramOrNull` повертає `null`), сканер повертає порожній масив. Це навмисний відмовостійкий шлях: спершу треба полагодити синтаксис, потім перезапускати перевірку.
- **Opt-in маркери-коментарі**: деякі небезпечні патерни можна свідомо дозволити, проставивши коментар `// allow-unsafe: <reason>` або `// allow-pg-leftover: <reason>` на тому ж рядку, що й виклик, або на рядку безпосередньо вище. Причина (`<reason>`) обов'язкова — інакше маркер не приймається.
- **Скоп файлу**: pg-format-шими, pg-leftover-виклики та інші «недомігровані» патерни шукаються лише у файлах, де **в цьому ж файлі** є `import { sql|SQL } from 'bun'` — щоб не плутати з невинними збігами імен у непов'язаному коді.

## Експорти / API

Усі експорти — іменовані (named exports), default-експорту немає.

### Експортовані функції-сканери (повертають список порушень)

| Функція                                                                 | Сигнатура (скорочено)                                     | Що шукає                                                                                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `findBunSqlPerRequestConnectionInText(content, virtualPath?)`           | `(string, string?) => { line, snippet }[]`                | `new SQL(...)` усередині будь-якої функції (порушення singleton-пулу).                                                           |
| `findBunSqlUnsafeUseWithoutAllowMarkerInText(content, virtualPath?)`    | `(string, string?) => { line, snippet }[]`                | `<obj>.unsafe(...)` без `// allow-unsafe: <reason>`.                                                                             |
| `findBunSqlUnsafeWithInterpolatedTemplateInText(content, virtualPath?)` | `(string, string?) => { line, snippet }[]`                | `<obj>.unsafe(\`...${x}...\`)`— interpolated template literal як аргумент`unsafe` (injection-поверхня навіть із allow-маркером). |
| `findBunSqlPgLeftoverCallInText(content, virtualPath?)`                 | `(string, string?) => { line, snippet, methodName }[]`    | `<obj>.connect(...)` / `<obj>.end(...)` у Bun SQL-файлах без `// allow-pg-leftover: <reason>`.                                   |
| `findUnsafeBunSqlDynamicSqlListInText(content, virtualPath?)`           | `(string, string?) => { line, snippet }[]`                | `IN (...)` / `VALUES (...)` з `.join(',')` у template literal.                                                                   |
| `findUnsafeBunSqlInListMissingEmptyGuardInText(content, virtualPath?)`  | `(string, string?) => { line, snippet, reason, name? }[]` | `IN (${...})` без винесення у змінну або без guard `if (empty) throw` перед запитом.                                             |
| `findPgFormatShimDefinitionInText(content, virtualPath?)`               | `(string, string?) => { line, snippet, kind, name }[]`    | Визначення pg-format-сумісних шимів (`format`, `pgFormat`, `quoteLiteral`, ...).                                                 |
| `findPgFormatLikeQueryWrapperInText(content, virtualPath?)`             | `(string, string?) => { line, snippet }[]`                | Об'єктні pg-сумісні `{ query(text, params) { ... unsafe ... } }`-обгортки.                                                       |
| `findPgLibImportInText(content, virtualPath?)`                          | `(string, string?) => { line, snippet }[]`                | Імпорт/`require('pg')` (точно пакет `pg`, не `pg-format`/`pg-pool`).                                                             |
| `findPgListenNotifyUsageInText(content, virtualPath?)`                  | `(string, string?) => { line, snippet, kind }[]`          | LISTEN/UNLISTEN/NOTIFY-запити та `.on('notification', ...)`-listener'и.                                                          |

### Експортовані допоміжні предикати

| Функція                                     | Сигнатура             | Призначення                                                                                                                    |
| ------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `textHasBunSqlImport(content)`              | `(string) => boolean` | Текстова перевірка: чи є у файлі `import { sql\|SQL } from 'bun'`. Дешевий pre-filter (без AST).                               |
| `textHasPgLibImport(content)`               | `(string) => boolean` | Текстова перевірка: чи є у файлі `import ... from 'pg'` або `require('pg')`. Не матчить `pg-format`, `pg-pool`.                |
| `isBunSqlScanSourceFile(relativePathPosix)` | `(string) => boolean` | Чи сканувати цей файл за розширенням: JS/TS-сімʼя (`.js`, `.cjs`, `.mjs`, `.jsx`, `.ts`, `.cts`, `.mts`, `.tsx`), без `.d.ts`. |

### Не експортовані сутності (internal helpers)

Регулярки-константи:

- `SOURCE_FILE_RE` — розширення JS/TS-сімʼї.
- `BUN_SQL_IMPORT_RE` — `import { sql\|SQL } from 'bun'`.
- `PG_LIB_IMPORT_RE` — `import ... from 'pg'` або `require('pg')` (без `pg-format`/`pg-pool`).
- `PG_LISTEN_NOTIFY_SQL_RE` — рядок, що починається з `LISTEN\|UNLISTEN\|NOTIFY` (case-insensitive).
- `IN_PLACEHOLDER_END_RE` — quasi, що закінчується на `IN ` або `IN (`.
- `ALLOW_UNSAFE_MARKER_RE` — `allow-unsafe: <непорожня причина>`.
- `ALLOW_PG_LEFTOVER_MARKER_RE` — `allow-pg-leftover: <непорожня причина>`.
- `PG_FORMAT_PLACEHOLDER_RE` — `%L`, `%I`, `%s`.
- `PG_QUERY_FIRST_PARAM_RE` — `text\|sql\|query` (імена першого параметра pg-style query-обгортки).

Set-константи:

- `PG_LEFTOVER_METHOD_NAMES` — `{ 'connect', 'end' }`.
- `PG_FORMAT_SHIM_FUNC_NAMES` — `{ 'format', 'pgFormat', 'sqlFormat', 'pgFmt' }`.
- `QUOTE_HELPER_NAMES` — `{ 'quoteLiteral', 'quoteIdent', 'escapeLiteral', 'escapeIdent' }`.

Внутрішні функції-предикати/витягувачі:

- `isLengthMember`, `isZeroNumberLiteral`, `isSqlHelperIdentifier`, `isEmptyListTest`, `consequentHasThrow`, `hasEmptyGuardBefore`, `findEnclosingBlockAndStatementIndex`, `isNewSqlConstructor`, `isUnsafeCall`, `isUnsafeCallNode` (alias), `hasMarkerCommentNear`, `asPgLeftoverCall`, `propertyKeyName`, `nodeContainsPgFormatPlaceholder`, `asNamedFunctionDecl`, `asPgFormatLikeQueryProp`, `hasPgQuerySignature`, `nodeContainsUnsafeCall`, `extractInListVarNameFromExpr`, `collectInListGuardViolationsFromTemplate`, `getStringLiteralValue`, `isRequireOfModule`, `listenNotifyFromCallExpression`, `listenNotifyFromTaggedTemplate`, `sqlStringStartsWithListenNotify`, `kindFromListenNotifyMatch`.

## Функції

### Експортовані сканери

#### `findBunSqlPerRequestConnectionInText(content, virtualPath = 'scan.ts')`

- **Параметри**: `content` — вихідний код; `virtualPath` — шлях для вибору `lang` парсером.
- **Повертає**: `Array<{ line: number, snippet: string }>`.
- **Що робить**: парсить програму через `parseProgramOrNull`. Якщо парс невдалий — повертає `[]`. Інакше обходить AST через `walkAstWithAncestors`. Для кожного `NewExpression` із callee-Identifier `SQL` перевіряє, чи знаходиться вузол усередині функції (через `ancestors.some(isFunctionNode)`). Якщо так — додає `{ line, snippet }` у результат.
- **Side effects**: жодних (чиста функція, повертає новий масив).
- **Контракт парсера**: ця функція **не** перевіряє, чи є у файлі `import { sql\|SQL } from 'bun'` — її викликає правило, яке вже встановило цю передумову.

#### `findBunSqlUnsafeUseWithoutAllowMarkerInText(content, virtualPath = 'scan.ts')`

- **Параметри**: вихідний код і опційний `virtualPath`.
- **Повертає**: `Array<{ line: number, snippet: string }>`.
- **Що робить**: парсить програму **разом із коментарями** через `parseProgramAndCommentsOrNull`. Для кожного виклику `<obj>.unsafe(...)` (визначається `isUnsafeCall`) перевіряє наявність маркера `// allow-unsafe: <reason>` поруч (через `hasMarkerCommentNear` + `ALLOW_UNSAFE_MARKER_RE`). Якщо маркера немає — додає у результат.
- **Семантика**: `<obj>` — будь-який об'єкт (`sql.unsafe`, `tx.unsafe`, `db.unsafe` тощо). Розрізняти імена не треба, бо файл сканується лише при наявності Bun SQL-імпорту (це передумова правила; у самій функції не перевіряється).
- **Side effects**: немає.

#### `findBunSqlUnsafeWithInterpolatedTemplateInText(content, virtualPath = 'scan.ts')`

- **Параметри**: вихідний код, `virtualPath`.
- **Повертає**: `Array<{ line: number, snippet: string }>`.
- **Що робить**: знаходить виклики `<obj>.unsafe(...)`, де перший аргумент — `TemplateLiteral` із непорожнім масивом `expressions`. Тобто `sql.unsafe(\`... ${x} ...\`)`. Цей патерн прапорує **навіть з маркером `// allow-unsafe`**, бо template-interpolation у `unsafe` — структурна injection-поверхня (не екранує identifier'ів і не біндить значення).
- **Що НЕ прапорує**: статичні рядки (`Literal`, `StringLiteral`, `TemplateLiteral` без `${...}`), виклики з готовим текстом-змінною. Для них діє основна перевірка `findBunSqlUnsafeUseWithoutAllowMarkerInText`.
- **Side effects**: немає.

#### `findBunSqlPgLeftoverCallInText(content, virtualPath = 'scan.ts')`

- **Параметри**: вихідний код, `virtualPath`.
- **Повертає**: `Array<{ line: number, snippet: string, methodName: 'connect' \| 'end' }>`.
- **Що робить**: спочатку перевіряє через `textHasBunSqlImport(content)` — якщо у файлі **немає** імпорту Bun SQL, повертає `[]` (скоп навмисно вузький: метод-імена `connect`/`end` занадто загальні — є у WebSocket, Stream, інших API). Інакше парсить програму з коментарями. Для кожного `<obj>.connect(...)` / `<obj>.end(...)` (через `asPgLeftoverCall`) перевіряє маркер `// allow-pg-leftover: <reason>`. Якщо маркера немає — додає у результат із `methodName`.
- **Side effects**: немає.

#### `findUnsafeBunSqlDynamicSqlListInText(content, virtualPath = 'scan.ts')`

- **Параметри**: вихідний код, `virtualPath`.
- **Повертає**: `Array<{ line: number, snippet: string }>`.
- **Що робить**: знаходить `TemplateLiteral` (як standalone, так і всередині `TaggedTemplateExpression`), де контекст — `IN (...)` / `VALUES (...)` (`isSqlListContextTemplate`) і серед expressions є виклик `.join(...)` (`isJoinCall`). Це означає, що у запит потрапляє конкатенований SQL замість параметризованих значень — треба використати `sql([...])`-helper.
- **Side effects**: немає.

#### `findUnsafeBunSqlInListMissingEmptyGuardInText(content, virtualPath = 'scan.ts')`

- **Параметри**: вихідний код, `virtualPath`.
- **Повертає**: `Array<{ line: number, snippet: string, reason: 'not_var' \| 'sql_helper_not_var' \| 'missing_guard', name? }>`.
- **Що робить**: знаходить SQL-list контексти (`IN (`/`IN`/`VALUES`-quasi) і обробляє кожен такий template через `collectInListGuardViolationsFromTemplate`. Якщо expression у `${...}` після `IN ` / `IN (` — це не Identifier (наприклад, виклик або складний вираз) — повертає `reason: 'not_var'`. Якщо це `sql(<non-Identifier>)` — `reason: 'sql_helper_not_var'`. Якщо це Identifier, але перед запитом у поточному `BlockStatement` немає guard'а `if (!ids.length) throw ...` / `if (ids.length === 0) throw ...` — `reason: 'missing_guard'` із `name`.
- **Side effects**: немає.

#### `findPgFormatShimDefinitionInText(content, virtualPath = 'scan.ts')`

- **Параметри**: вихідний код, `virtualPath`.
- **Повертає**: `Array<{ line: number, snippet: string, kind: 'format_function' \| 'quote_helper', name: string }>`.
- **Що робить**: pre-filter: `textHasBunSqlImport(content)` — якщо у файлі немає Bun SQL, повертає `[]`. Інакше парсить програму та шукає визначення функцій верхнього рівня (`FunctionDeclaration` або `VariableDeclarator` з `ArrowFunctionExpression`/`FunctionExpression`). Для кожного:
  - якщо ім'я ∈ `QUOTE_HELPER_NAMES` (`quoteLiteral`, `quoteIdent`, `escapeLiteral`, `escapeIdent`) — прапорує **незалежно від тіла** як `'quote_helper'`;
  - якщо ім'я ∈ `PG_FORMAT_SHIM_FUNC_NAMES` (`format`, `pgFormat`, `sqlFormat`, `pgFmt`) **і** тіло містить літерал з `%L\|%I\|%s` (`nodeContainsPgFormatPlaceholder`) — прапорує як `'format_function'`.
- **Snippet**: обмежений до 240 символів від `node.start`.
- **Side effects**: немає.

#### `findPgFormatLikeQueryWrapperInText(content, virtualPath = 'scan.ts')`

- **Параметри**: вихідний код, `virtualPath`.
- **Повертає**: `Array<{ line: number, snippet: string }>`.
- **Що робить**: pre-filter `textHasBunSqlImport`. Далі обходить AST, шукає `ObjectExpression`, у яких є властивість `query` з функцією-значенням, що:
  - має 1–2 параметри (`hasPgQuerySignature`);
  - перший параметр — Identifier з типовим pg-іменем (`text`/`sql`/`query`);
  - у тілі функції є виклик `<obj>.unsafe(...)` (`nodeContainsUnsafeCall`).
- **Призначення**: знаходить «маскування» `unsafe` під безпечним ім'ям `query(text, params)` у pg-сумісній обгортці.
- **Side effects**: немає.

#### `findPgLibImportInText(content, virtualPath = 'scan.ts')`

- **Параметри**: вихідний код, `virtualPath`.
- **Повертає**: `Array<{ line: number, snippet: string }>`.
- **Що робить**: парсить програму, шукає `ImportDeclaration` із `source.value === 'pg'` або `CallExpression` виду `require('pg')`. Точне співпадіння — `pg-format`/`pg-pool`/`@types/pg` не матчаться.
- **Side effects**: немає.

#### `findPgListenNotifyUsageInText(content, virtualPath = 'scan.ts')`

- **Параметри**: вихідний код, `virtualPath`.
- **Повертає**: `Array<{ line: number, snippet: string, kind: 'listen_sql' \| 'notify_sql' \| 'unlisten_sql' \| 'notification_listener' }>`.
- **Що робить**: обходить AST. Для кожного вузла пробує дві сигнатури:
  - `listenNotifyFromCallExpression`: `<obj>.query(...)` / `.queryArray(...)` / `.queryStream(...)` з першим аргументом — string literal або template literal, що починається з `LISTEN`/`UNLISTEN`/`NOTIFY`; також `<obj>.on('notification', fn)`.
  - `listenNotifyFromTaggedTemplate`: TaggedTemplateExpression, де перший quasi починається з `LISTEN`/`UNLISTEN`/`NOTIFY`.
- **Призначення**: легітимна потреба у клієнті `pg` — Bun SQL не має LISTEN/NOTIFY. Сигнал для правила «можна виключити pg із заборони у цьому файлі».
- **Side effects**: немає.

### Експортовані предикати

#### `textHasBunSqlImport(content)`

- Сигнатура: `(string) => boolean`.
- Текстова перевірка `BUN_SQL_IMPORT_RE`. Без AST — для дешевого pre-filter'у при зборі ознак авто-детекту правил.

#### `textHasPgLibImport(content)`

- Сигнатура: `(string) => boolean`.
- Текстова перевірка `PG_LIB_IMPORT_RE`. Швидкий pre-filter; точне місце імпорту — через `findPgLibImportInText`.

#### `isBunSqlScanSourceFile(relativePathPosix)`

- Сигнатура: `(string) => boolean`.
- Перевіряє розширення за `SOURCE_FILE_RE` (`.js`, `.cjs`, `.mjs`, `.jsx`, `.ts`, `.cts`, `.mts`, `.tsx`) і відкидає `.d.ts`-файли.

### Внутрішні допоміжні функції (не експортуються)

| Функція                                                                       | Призначення                                                                                                                                              |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isLengthMember(node, name)`                                                  | `MemberExpression` виду `<name>.length`.                                                                                                                 |
| `isZeroNumberLiteral(node)`                                                   | Числовий літерал `0` (`NumericLiteral` або `Literal`).                                                                                                   |
| `isSqlHelperIdentifier(node)`                                                 | Identifier з ім'ям `sql`.                                                                                                                                |
| `extractInListVarNameFromExpr(expr)`                                          | З `${ids}` → `{ name: 'ids' }`; з `${sql(ids)}` → `{ name: 'ids' }`; інакше — `{ error: 'not_var' \| 'sql_helper_not_var' }`.                            |
| `isEmptyListTest(test, name)`                                                 | Чи це `!ids.length` / `ids.length === 0` / `<= 0` / `< 1` (і дзеркальні форми).                                                                          |
| `consequentHasThrow(consequent)`                                              | Чи `consequent` (statement або `BlockStatement`) містить `ThrowStatement`.                                                                               |
| `hasEmptyGuardBefore(block, statementIndex, name)`                            | Чи у `block.body` до індексу `statementIndex` є `IfStatement` з `isEmptyListTest` + `consequentHasThrow`.                                                |
| `findEnclosingBlockAndStatementIndex(ancestors)`                              | Шукає найближчий `BlockStatement` і індекс statement у ньому.                                                                                            |
| `isNewSqlConstructor(node)`                                                   | `NewExpression` з callee-Identifier `SQL`.                                                                                                               |
| `isUnsafeCall(node)` / `isUnsafeCallNode` (alias)                             | `CallExpression` з `callee` = `MemberExpression` `<obj>.unsafe` (не computed).                                                                           |
| `hasMarkerCommentNear(callNode, comments, content, markerRe)`                 | Чи є маркер-коментар, що матчиться на `markerRe`, на тому ж рядку, що `callNode.start`, або рядком вище. Block-коментарі: важливим є `endLine`.          |
| `asPgLeftoverCall(node)`                                                      | Якщо це `<obj>.connect(...)` або `<obj>.end(...)` — повертає `{ name }`; інакше `null`.                                                                  |
| `propertyKeyName(key)`                                                        | Витягає ім'я з `Property.key` (`Identifier.name` або `Literal.value` для string/number).                                                                 |
| `nodeContainsPgFormatPlaceholder(root)`                                       | Чи у піддереві є літерал/regex/template з `%L`/`%I`/`%s`.                                                                                                |
| `asNamedFunctionDecl(node)`                                                   | З `FunctionDeclaration` або `VariableDeclarator` з функцією-init — повертає `{ name, body }`.                                                            |
| `asPgFormatLikeQueryProp(prop)`                                               | Чи це `{ query(text, params) { ... unsafe ... } }`-Property.                                                                                             |
| `hasPgQuerySignature(params)`                                                 | 1–2 параметри, перший — Identifier з ім'ям `text`/`sql`/`query`.                                                                                         |
| `nodeContainsUnsafeCall(root)`                                                | Чи у піддереві є `<obj>.unsafe(...)`.                                                                                                                    |
| `collectInListGuardViolationsFromTemplate(template, ancestors, content, out)` | Збирає порушення для одного template'а у контексті `IN (...)`. **Side effect**: пушить у переданий буфер `out`.                                          |
| `getStringLiteralValue(node)`                                                 | `Literal`/`StringLiteral`-значення (string) або `null`.                                                                                                  |
| `isRequireOfModule(node, moduleName)`                                         | Чи `CallExpression` — це `require('<moduleName>')` (точне співпадіння).                                                                                  |
| `listenNotifyFromCallExpression(node)`                                        | Для `<obj>.query/.queryArray/.queryStream(...)` з LISTEN/NOTIFY-рядком — повертає kind; для `<obj>.on('notification', ...)` — `'notification_listener'`. |
| `listenNotifyFromTaggedTemplate(node)`                                        | Для TaggedTemplateExpression, де перший quasi починається з LISTEN/UNLISTEN/NOTIFY — повертає kind.                                                      |
| `sqlStringStartsWithListenNotify(arg)`                                        | Аналіз першого аргумента `.query(...)`: string literal або template literal → kind.                                                                      |
| `kindFromListenNotifyMatch(text)`                                             | Текст → `'listen_sql'`/`'notify_sql'`/`'unlisten_sql'` або `null` (UNLISTEN мапиться у `unlisten_sql`).                                                  |

## Залежності

### Внутрішні (з `../../../scripts/utils/ast-scan-utils.mjs`)

Усі named imports:

- `isFunctionNode(node)` — чи вузол — функція (FunctionDeclaration / FunctionExpression / ArrowFunctionExpression / MethodDefinition тощо).
- `isJoinCall(expr)` — чи вираз — виклик `<obj>.join(...)`.
- `isSqlListContextTemplate(template)` — чи `TemplateLiteral` має `IN (...)` / `VALUES (...)` контекст у quasi.
- `normalizeSnippet(s)` — нормалізує snippet (стискає пробіли тощо).
- `offsetToLine(content, offset)` — переводить байтовий offset у номер рядка (1-індекс).
- `parseProgramAndCommentsOrNull(content, virtualPath)` — парсить через oxc-parser, повертає `{ program, comments }` або `null` при помилці.
- `parseProgramOrNull(content, virtualPath)` — парсить програму без коментарів, повертає `program` або `null`.
- `templateQuasisText(template)` — обʼєднує текст quasis у один рядок (без expressions).
- `walkAstWithAncestors(root, ancestors, visitor)` — обхід AST із передачею стека ancestors у visitor.

### Зовнішні

Прямих імпортів зовнішніх npm-пакетів немає. Опосередковано через `ast-scan-utils.mjs` використовується **oxc-parser**.

### Глобальні / runtime

- Стандартні JS-API: `RegExp`, `Set`, `Array`, `String.prototype.slice`/`Math.min`/`Array.prototype.entries`/`Array.prototype.indexOf` тощо.

## Потік виконання / Використання

### Загальна модель

Файл — це **бібліотека функцій без побічних ефектів**. Сам по собі модуль не виконує сканування при імпорті: тільки експортує функції-фабрики результатів. Викликаються вони з check-функцій правил (`check-*.mjs`) у `npm/rules/js-bun-db/`.

### Типовий потік виклику з правила

1. Правило отримує список файлів проекту.
2. Для кожного файлу фільтрує через `isBunSqlScanSourceFile(relativePathPosix)` — лише JS/TS-файли, без `.d.ts`.
3. Для дешевого pre-filter'у читає вміст і викликає `textHasBunSqlImport(content)`. Якщо `false` — пропускає файл (для скан-функцій, що працюють лише у Bun SQL-файлах).
4. Викликає одну з функцій-сканерів `find...InText(content, relativePath)`. Отримує масив порушень із `line`/`snippet`/інколи додатковими полями (`reason`, `name`, `kind`, `methodName`).
5. Перетворює порушення на `fail`-повідомлення у форматі правила.

### Загальний контракт парсера

- Якщо `parseProgramOrNull` / `parseProgramAndCommentsOrNull` повертає `null` (синтаксична помилка) — сканер повертає `[]`. **Це не еквівалентно «жодних порушень»**: правило має іншим механізмом (інші лінтери) переконатися, що файл взагалі парситься.
- `virtualPath` (за замовчуванням `'scan.ts'`) передається парсеру для вибору мови (`lang` — `ts`/`tsx`/`js`/`jsx`/`cjs`/`mjs` тощо за розширенням). За замовчуванням `'scan.ts'` — щоб TypeScript-конструкції не ламали парс при не-TS-файлах із TS-подібним кодом.

### Опт-ін маркери коментарів (формат і правила позиціювання)

Дозволені маркери:

- `// allow-unsafe: <reason>` — для `<obj>.unsafe(...)`.
- `// allow-pg-leftover: <reason>` — для `<obj>.connect(...)` / `<obj>.end(...)`.

Правила позиціювання (через `hasMarkerCommentNear`):

- Маркер дійсний, якщо коментар закінчується на тому ж рядку, що й виклик (`trailing comment`), **або** на рядку, що безпосередньо передує виклику.
- Між коментарем і викликом **не** допускається порожній рядок (відірваний коментар не зараховується).
- `<reason>` має бути непорожнім (хоча б один не-пробільний символ після `:`) — інакше маркер не приймається.
- Допускається як `Line`-коментар (`// ...`), так і `Block`-коментар (`/* ... */`); для блокового важлива саме `endLine` (бо block може займати кілька рядків).

### Послідовність ухвалення рішення для деяких сканерів

**`findBunSqlUnsafeWithInterpolatedTemplateInText`** працює **незалежно** від `findBunSqlUnsafeUseWithoutAllowMarkerInText` — interpolated template у `unsafe` прапорується навіть із `// allow-unsafe`. Це навмисно: маркер дозволяє статичний `unsafe`-рядок, але не виправдовує template-interpolation.

**`findUnsafeBunSqlInListMissingEmptyGuardInText`** і **`findUnsafeBunSqlDynamicSqlListInText`** покривають дотичні, але різні випадки `IN (...)`:

- `join`-конкатенація у будь-якому контексті списку (`IN`/`VALUES`) → `findUnsafeBunSqlDynamicSqlListInText`.
- `IN (${vars})` без guard'у → `findUnsafeBunSqlInListMissingEmptyGuardInText`.

### Приклади для розуміння (концептуально)

1. **`new SQL(...)` per-request** — прапорує:

   ```js
   import { SQL } from 'bun'

   /**
    *
    */
   export async function handler(req) {
     const sql = new SQL(process.env.DATABASE_URL) // <-- порушення
     return sql`select 1`
   }
   ```

2. **`unsafe` без маркера** — прапорує:

   ```js
   import { sql } from 'bun'

   const text = `select * from ${tableName}`
   sql.unsafe(text) // <-- порушення: немає // allow-unsafe: <reason>
   ```

3. **`unsafe` з interpolated template** — прапорує навіть з маркером:

   ```js
   sql.unsafe(`select * from ${tableName}`) // allow-unsafe: dynamic-table
   //  ^-- прапорується сканером findBunSqlUnsafeWithInterpolatedTemplateInText
   ```

4. **`IN (${ids})` без guard'у** — прапорує:

   ```js
   const ids = req.body.ids
   await sql`select * from t where id in (${ids})` // <-- reason: 'missing_guard'
   ```

   Виправлення — додати guard:

   ```js
   if (!ids.length) throw new Error('empty ids')
   await sql`select * from t where id in (${sql(ids)})`
   ```

5. **pg-leftover у Bun SQL-файлі** — прапорує:

   ```js
   import { sql } from 'bun'

   await sql.end() // <-- порушення: немає // allow-pg-leftover: <reason>
   ```

### Інваріанти

- Усі експортовані функції **детерміновані**: для одного й того ж `content` і `virtualPath` повертають однаковий результат.
- Функції **не модифікують глобальний стан** і не мають кешу — кешування (якщо потрібне) робиться на рівні викликача (правила).
- Знахідки повертаються у порядку обходу AST (від `walkAstWithAncestors`); `line` — 1-індексований.
- Snippet у `findPgFormatShimDefinitionInText` обмежений до 240 символів; у решті — це повний текст знайденого вузла.

## Rebuild Test

Контрольний перелік, що дає змогу відновити інваріанти та логіку модуля «з нуля» лише з документації:

1. **Список експортів** (10 функцій):
   - сканери: `findBunSqlPerRequestConnectionInText`, `findBunSqlUnsafeUseWithoutAllowMarkerInText`, `findBunSqlUnsafeWithInterpolatedTemplateInText`, `findBunSqlPgLeftoverCallInText`, `findUnsafeBunSqlDynamicSqlListInText`, `findUnsafeBunSqlInListMissingEmptyGuardInText`, `findPgFormatShimDefinitionInText`, `findPgFormatLikeQueryWrapperInText`, `findPgLibImportInText`, `findPgListenNotifyUsageInText`;
   - предикати: `textHasBunSqlImport`, `textHasPgLibImport`, `isBunSqlScanSourceFile`.
2. **Контракт парс-помилок**: будь-який сканер, що отримав `null` від `parseProgramOrNull`/`parseProgramAndCommentsOrNull`, повертає `[]`.
3. **Опт-ін маркери**: `// allow-unsafe: <reason>` (для `unsafe`), `// allow-pg-leftover: <reason>` (для `connect`/`end`). Дозволені позиції — той самий рядок (trailing) або безпосередньо попередній рядок. Причина обов'язкова.
4. **Скоп Bun SQL-залежних сканерів**: `findBunSqlPgLeftoverCallInText`, `findPgFormatShimDefinitionInText`, `findPgFormatLikeQueryWrapperInText` спочатку перевіряють `textHasBunSqlImport(content)` і повертають `[]`, якщо `false`.
5. **Структура повернень**: усі сканери повертають масиви об'єктів із як мінімум `{ line: number, snippet: string }`; деякі додають `reason` / `name` / `kind` / `methodName`.
6. **AST-семантика, не regex**: усі сканери використовують `walkAstWithAncestors` і AST-предикати; regex використовуються лише для текстових pre-filter'ів і коротких рядкових патернів.
7. **Розширення для скану**: `.js`, `.cjs`, `.mjs`, `.jsx`, `.ts`, `.cts`, `.mts`, `.tsx`; `.d.ts` — виключено.
8. **`IN (...)`/`VALUES (...)` guard-логіка**:
   - `not_var` — у `${...}` стоїть не Identifier;
   - `sql_helper_not_var` — у `${sql(<x>)}` `x` — не Identifier;
   - `missing_guard` — Identifier є, але перед запитом у тому ж `BlockStatement` немає `if (!ids.length) throw` / `if (ids.length === 0/<=0/<1) throw` (включно з дзеркальними `0 === ids.length` для `==`/`===`).
9. **pg-format-шими**: іменам `quoteLiteral`/`quoteIdent`/`escapeLiteral`/`escapeIdent` достатньо самого імені; іменам `format`/`pgFormat`/`sqlFormat`/`pgFmt` — додатково потрібен `%L`/`%I`/`%s` десь у тілі (літерал/regex/template).
10. **pg-сумісний query-wrapper**: `Property` з `key === 'query'` у `ObjectExpression`, з функцією-значенням, що має 1–2 параметри (перший — Identifier `text`/`sql`/`query`) і викликає `<obj>.unsafe(...)` десь у тілі.
11. **LISTEN/NOTIFY-сигнали**: `<obj>.query/.queryArray/.queryStream(...)` з першим аргументом — string/template literal, що починається з `LISTEN`/`UNLISTEN`/`NOTIFY` (case-insensitive); `<obj>.on('notification', ...)`; TaggedTemplateExpression з тим самим початком у першому quasi.
12. **pg-імпорт**: `ImportDeclaration` з `source.value === 'pg'` або `CallExpression` `require('pg')` — точне співпадіння; `pg-format`/`pg-pool` не матчаться.
13. **`new SQL(...)` per-request**: `NewExpression` із callee-Identifier `SQL` і ancestors, серед яких є функція.
14. **Snippet limit у `findPgFormatShimDefinitionInText`**: 240 символів від `node.start` (через `Math.min(node.end, node.start + 240)`); решта сканерів використовують `content.slice(start, end)`.
15. **Determinism і відсутність side effects**: усі експортовані функції — чисті; локальний `collectInListGuardViolationsFromTemplate` має side effect лише на переданий буфер `out`.

Якщо всі ці пункти відтворені в коді — сканер семантично еквівалентний оригіналу.
