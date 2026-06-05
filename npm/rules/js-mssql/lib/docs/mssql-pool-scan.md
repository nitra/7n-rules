# mssql-pool-scan.mjs

## Огляд

Модуль `mssql-pool-scan.mjs` — це набір AST-сканерів, що шукають **небезпечні патерни використання драйвера `mssql`** (Microsoft SQL Server для Node.js) у вихідних файлах JavaScript / TypeScript. Сканери призначені для статичного аналізу й використовуються з правил `js-mssql` (див. `js-mssql.mdc`).

Модуль виявляє п'ять класів проблем:

1. **Створення `new sql.ConnectionPool(...)` / `new mssql.ConnectionPool(...)` всередині функції.** Це антипатерн: пул має бути singleton на рівні модуля, а не створюватися на кожен запит/виклик.
2. **Небезпечний виклик `query(\`...\`)`** — звичайний `CallExpression` з `TemplateLiteral` як першим аргументом (не tagged template). Це може призвести до **SQL injection**, бо інтерполяція відбувається на рівні JS і в SQL потрапляє вже склеєний рядок.
3. **Shared `Request`** — `export const request = pool.request()` (або `const request = pool.request()`), який не можна повторно використовувати між запитами в драйвері `mssql`.
4. **Динамічні SQL-списки через `.join(...)`** у `TemplateLiteral` / `TaggedTemplateExpression` у контексті `IN (...)` або `VALUES (...)`. Навіть у tagged template це небезпечно, бо в запит підставляється готовий шматок SQL.
5. **`IN (${...})` без числового парсера й/або без guard-перевірки на порожній список.** Навіть у безпечному tagged template значення треба явно приводити до Number/BigInt і відкидати NaN, а перед запитом — перевіряти, що список не порожній (`if (!ids.length) throw ...`).

Парсинг виконується через **`oxc-parser`** (`parseSync`). Якщо файл не парситься або містить синтаксичні помилки — кожна функція повертає **порожній масив** (треба спочатку полагодити синтаксис і перезапустити сканування).

Файл живе всередині `npm/rules/js-mssql/lib/` й експортує **6 публічних функцій** (5 сканерів + 1 фільтр розширень файлів). Допоміжні функції (перевірки AST-вузлів, трасування Identifier-ів) — приватні.

---

## Експорти / API

| Експорт                                                               | Тип      | Призначення                                                                               |
| --------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------- |
| `findMssqlPerRequestConnectionInText(content, virtualPath?)`          | function | Знайти `new sql.ConnectionPool(...)` / `new mssql.ConnectionPool(...)` всередині функцій. |
| `findUnsafeMssqlQueryTemplateCallInText(content, virtualPath?)`       | function | Знайти `obj.query(\`...\`)`— небезпечну інтерполяцію в`query(...)`.                       |
| `findSharedMssqlRequestInText(content, virtualPath?)`                 | function | Знайти shared `Request`: `const request = something.request()`.                           |
| `findUnsafeMssqlDynamicSqlListInText(content, virtualPath?)`          | function | Знайти `IN (...)` / `VALUES (...)` зі склеєним `.join(',')` у `${...}`.                   |
| `findUnsafeMssqlInListUnparsedInText(content, virtualPath?)`          | function | Знайти `IN (${expr})`, де `expr` не пройшов числовий парсер.                              |
| `findUnsafeMssqlInListMissingEmptyGuardInText(content, virtualPath?)` | function | Знайти `IN (${...})` без guard `if (empty) throw` (або без винесення у змінну).           |
| `isMssqlScanSourceFile(relativePathPosix)`                            | function | Фільтр файлів для сканування за розширенням.                                              |

### Загальна форма результату сканерів

Усі сканери, окрім останнього missing-guard-сканера, повертають масив об'єктів виду:

```
{
  line: number,    // 1-based номер рядка в content
  snippet: string  // нормалізований фрагмент вихідного коду (через normalizeSnippet)
}
```

Сканер `findUnsafeMssqlInListMissingEmptyGuardInText` додатково повертає поля `reason: 'not_var' | 'missing_guard'` та опційне `name: string` (імʼя Identifier-у, для якого не знайдено guard).

`isMssqlScanSourceFile` повертає `boolean`.

### Спільні параметри сканерів

- `content: string` — повний вихідний код файлу.
- `virtualPath: string` — необовʼязковий «віртуальний» шлях файлу (наприклад `pkg/src/db.ts`), потрібний `oxc-parser`, щоб обрати мову (`lang`) через `langFromPath`. За замовчуванням — `'scan.ts'`.

---

## Функції

### Експортовані функції

#### `findMssqlPerRequestConnectionInText(content, virtualPath = 'scan.ts')`

- **Сигнатура:** `(content: string, virtualPath?: string) => { line: number, snippet: string }[]`
- **Параметри:**
  - `content` — вихідний код для сканування.
  - `virtualPath` — шлях для вибору мови парсера (`lang`).
- **Повертає:** масив порушень `{ line, snippet }`. Порожній масив, якщо файл не парситься або немає порушень.
- **Що шукає:** `NewExpression` виду `new sql.ConnectionPool(...)` або `new mssql.ConnectionPool(...)` (через `isNewConnectionPool`), і лише ті, що **знаходяться всередині будь-якої функції** (перевірка через `ancestors.some(isFunctionNode)`).
- **Side effects:** немає (чиста функція). Не кидає винятків — парсинг обгорнуто в `try/catch`.

#### `findUnsafeMssqlQueryTemplateCallInText(content, virtualPath = 'scan.ts')`

- **Сигнатура:** `(content: string, virtualPath?: string) => { line: number, snippet: string }[]`
- **Параметри:**
  - `content` — вихідний код.
  - `virtualPath` — шлях файлу для вибору `lang`.
- **Повертає:** масив `{ line, snippet }` для всіх `CallExpression`, що відповідають `<obj>.query(\`...\`)`(метод`.query`без квадратних дужок, перший аргумент —`TemplateLiteral`).
- **Side effects:** немає.

#### `findSharedMssqlRequestInText(content, virtualPath = 'scan.ts')`

- **Сигнатура:** `(content: string, virtualPath?: string) => { line: number, snippet: string }[]`
- **Параметри:** як вище.
- **Повертає:** масив `{ line, snippet }`. Включає `VariableDeclarator`, у яких:
  - `id` — `Identifier` з імʼям рівно `request`;
  - `init` — `CallExpression` виду `<obj>.request()` (через `isRequestFactoryCall`).
- **Side effects:** немає.

#### `findUnsafeMssqlDynamicSqlListInText(content, virtualPath = 'scan.ts')`

- **Сигнатура:** `(content: string, virtualPath?: string) => { line: number, snippet: string }[]`
- **Параметри:** як вище.
- **Повертає:** масив `{ line, snippet }`. Виявляє `TemplateLiteral` або `TaggedTemplateExpression` (через `.quasi`), які одночасно:
  - Знаходяться в SQL-контексті списку `IN (...)` / `VALUES (...)` — через `isSqlListContextTemplate` (із `ast-scan-utils`).
  - Містять у `template.expressions` хоча б одну `CallExpression` `.join(...)` — через `isJoinCall`.
- `line`/`snippet` беруться по координатам `template.start` / `template.end`.
- **Side effects:** немає.

#### `findUnsafeMssqlInListUnparsedInText(content, virtualPath = 'scan.ts')`

- **Сигнатура:** `(content: string, virtualPath?: string) => { line: number, snippet: string }[]`
- **Параметри:** як вище.
- **Повертає:** масив `{ line, snippet }`. Виявляє `TemplateLiteral`, у яких:
  - Quasi прямо перед `expressions[i]` закінчується на `IN (` (regex `IN_PLACEHOLDER_END_RE`, `/\bin\s*\(\s*$/iu`).
  - Сам вираз `${...}` **не** є «безпечно числовим» за критеріями `isInListExpressionParsed` (літеральний масив чисел / піддерево з `parseInt|parseFloat|Number|BigInt|+x` / Identifier з безпечним `init`).
  - Вираз — не `.join(...)` (це покривається окремим сканером `findUnsafeMssqlDynamicSqlListInText`).
- Перед скануванням збирає всі `VariableDeclarator`-и в програмі через `collectVariableDeclarators` — щоб трасувати Identifier до його init у тому ж файлі.
- `line` рахується по `expr.start` (або, якщо не визначено, по `node.start`); `snippet` — від `node.start` до `node.end`.
- **Side effects:** немає.

#### `findUnsafeMssqlInListMissingEmptyGuardInText(content, virtualPath = 'scan.ts')`

- **Сигнатура:** `(content: string, virtualPath?: string) => { line: number, snippet: string, reason: 'not_var' | 'missing_guard', name?: string }[]`
- **Параметри:** як вище.
- **Повертає:** масив порушень. На кожен `${expr}` у позиції `IN (...)`:
  - Якщо `expr` — **не** `Identifier`, порушення з `reason: 'not_var'` (значення мали бути винесені у змінну, щоб мати точку для guard).
  - Якщо `expr` — `Identifier` `name`, але в enclosing-блоці перед поточним statement немає guard `if (empty(name)) throw`, — порушення з `reason: 'missing_guard'` і `name: <identifier>`.
  - Якщо guard є, порушення не додається.
- `line`/`snippet` беруться по `node.start` / `node.end` всього `TemplateLiteral`.
- **Side effects:** немає.

#### `isMssqlScanSourceFile(relativePathPosix)`

- **Сигнатура:** `(relativePathPosix: string) => boolean`
- **Параметри:** `relativePathPosix` — відносний шлях файлу у posix-форматі.
- **Повертає:** `true`, якщо файл має розширення `.js | .mjs | .cjs | .jsx | .ts | .mts | .cts | .tsx` (regex `SOURCE_FILE_RE` = `/\.([cm]?[jt]sx?)$/`) **і** не закінчується на `.d.ts` (декларації типів виключені).
- **Side effects:** немає.

### Приватні допоміжні функції

#### Локалізація `IN (...)` і числові гарантії

- `isZeroLiteral(node)` — `node` є літералом `0` (`NumericLiteral`/`Literal` зі значенням `0`).
- `isLengthMemberOf(node, name)` — `node` — некомпʼютоване `MemberExpression` `name.length`.
- `isEmptyListBinaryTest(test, name)` — `BinaryExpression` з оператором з `EMPTY_LIST_BINARY_OPERATORS` = `{ '===', '==', '<=', '<' }`, що порівнює `name.length` із літералом `0`. Для `===` і `==` (`EMPTY_LIST_REVERSED_OPERATORS`) дозволяється зворотний порядок (`0 === name.length`).
- `isEmptyListTest(test, name)` — тест if-умови виду `!name.length` або `name.length {===,==,<=} 0`, або `name.length < 1`. **Зауваження:** `<` із порівнянням з `0` через `isEmptyListBinaryTest` дає вираз `name.length < 0` (завжди false), що рідко зустрічається на практиці; типовий `length < 1` теж покривається через оператор `<` з правою частиною `1` — але `isZeroLiteral` приймає лише `0`, тож насправді `< 1` **не** розпізнається. (Це поведінка реалізації.)
- `consequentHasThrow(consequent)` — у consequent if-у (як один `ThrowStatement` або як `BlockStatement.body`) є `ThrowStatement`.
- `hasEmptyGuardBefore(block, statementIndex, name)` — у `block.body[0..statementIndex-1]` є `IfStatement`, який одночасно перевіряє «список порожній» (`isEmptyListTest`) і кидає (`consequentHasThrow`).
- `findEnclosingBlockAndStatementIndex(ancestors)` — у списку `ancestors` (зверху-вниз) знаходить найближчу пару `(BlockStatement, indexUnderItsBody)`, де statement з `ancestors[i]` входить у `block.body`.

#### Розпізнавання AST-патернів

- `isNewConnectionPool(node)` — `new {sql|mssql}.ConnectionPool(...)`.
- `isUnsafeQueryCallWithTemplateLiteral(node)` — `<obj>.query(\`...\`)`: метод `query`(некомпʼютований), перший аргумент —`TemplateLiteral`.
- `isRequestFactoryCall(node)` — `<obj>.request()`: будь-яке `CallExpression` з `.request` як методом (некомпʼютованим).

#### Гарантії числовості значень для `IN (${...})`

- `isLiteralNumericArrayExpression(node)` — `ArrayExpression`, всі елементи якого — `NumericLiteral`/`BigIntLiteral` або generic `Literal` зі значенням типу `number`/`bigint`. Масив має бути непорожнім.
- `isNumericParseCallExpression(node)` — `CallExpression`, де `callee` — це `Identifier` з імʼям з `NUMERIC_PARSE_FN_NAMES` = `{ parseInt, parseFloat, Number, BigInt }`, або `MemberExpression` з властивістю з того ж списку (наприклад `Number.parseInt(...)`).
- `subtreeHasNumericParseCall(node)` — рекурсивно обходить піддерево й повертає `true`, якщо знайшов `isNumericParseCallExpression` або `UnaryExpression` з оператором `+`. Поле `parent` пропускається, щоб уникнути нескінченних циклів.
- `isInListExpressionParsed(expr, declarators, seen=Set)` — головний критерій «безпечно числовий вираз». Повертає `true`, якщо:
  - `expr` — літеральний масив чисел;
  - або в піддереві `expr` є числовий парсер / унарний `+`;
  - або `expr` — `Identifier`, у якого знайдено `VariableDeclarator`-и у файлі, і **кожен** `init` цих декларацій рекурсивно проходить ту ж перевірку. `seen` — анти-цикл (Set уже трасованих імен). Якщо для Identifier немає видимого init (наприклад параметр функції чи import) — повертається `false`.

#### Збирачі порушень для `IN (...)` сканерів

- `collectVariableDeclarators(programNode)` — обхід AST і збір усіх `VariableDeclarator`-ів.
- `quasiRawText(q)` — повертає `q.value.raw` або `''`, якщо структура `q` не підходить (захист від нестандартних AST-вузлів).
- `collectInListUnparsedFromTemplate(node, content, declarators, out)` — для одного `TemplateLiteral`: для кожного `expressions[i]` перевіряє, що `quasis[i].value.raw` закінчується на `IN (` (`IN_PLACEHOLDER_END_RE`), й експресія не є `.join(...)` і не «парсована». Якщо так — додає `{ line, snippet }` у `out`.
- `collectInListMissingEmptyGuardFromTemplate(node, ancestors, content, out)` — для одного `TemplateLiteral`: для кожного `expressions[i]` після `IN (`:
  - якщо `expr` — не Identifier → порушення `not_var`;
  - якщо `expr` — Identifier, але в enclosing-блоці немає guard перед поточним statement → порушення `missing_guard` з `name`.

### Side effects по модулю в цілому

Жодна функція не звертається до файлової системи / мережі та не мутує вхідні дані; усе — pure-функції над рядками й AST. Парсинг `parseSync` із `oxc-parser` — синхронний, його винятки ловляться, і у разі помилки повертається `[]`.

---

## Залежності

### Зовнішні npm-залежності

- **`oxc-parser`** — імпорт `parseSync`. Швидкий парсер JS/TS (Rust-based) для побудови AST з вибором мови за `lang` і `sourceType: 'module'`.

### Внутрішні залежності проєкту

Усі імпортуються з відносного шляху `../../../scripts/utils/ast-scan-utils.mjs`:

- `isFunctionNode(node)` — чи `node` є функціональним AST-вузлом (FunctionDeclaration / FunctionExpression / ArrowFunctionExpression / тощо).
- `isJoinCall(node)` — чи `node` — це `CallExpression` виду `<x>.join(<sep>)`.
- `isSqlListContextTemplate(template)` — чи `TemplateLiteral` знаходиться у SQL-контексті списку (`IN (...)` / `VALUES (...)`).
- `langFromPath(path)` — обчислює `lang` для парсера за розширенням файлу (наприклад `'js'`, `'ts'`, `'tsx'`).
- `normalizeSnippet(text)` — нормалізує сирий фрагмент коду до однорядкового сніппета (підрізає пробіли/нові рядки).
- `offsetToLine(content, offset)` — конвертує абсолютний offset у вихідному коді в 1-based номер рядка.
- `walkAstWithAncestors(root, initialAncestors, visitor)` — обхід AST із трекінгом `ancestors` для кожного вузла.

### Константи модуля

- `SOURCE_FILE_RE = /\.([cm]?[jt]sx?)$/` — фільтр розширень сорсів.
- `IN_PLACEHOLDER_END_RE = /\bin\s*\(\s*$/iu` — детекція `... IN ( ` у raw-тексті quasi.
- `NUMERIC_PARSE_FN_NAMES = new Set(['parseInt', 'parseFloat', 'Number', 'BigInt'])` — імена-«парсери чисел».
- `EMPTY_LIST_BINARY_OPERATORS = new Set(['===', '==', '<=', '<'])` — оператори у тесті `name.length OP 0`.
- `EMPTY_LIST_REVERSED_OPERATORS = new Set(['===', '=='])` — оператори, для яких дозволено зворотний порядок `0 OP name.length`.

---

## Потік виконання / Використання

### Спільна каркасна логіка сканера

Усі сканери побудовані однаково:

1. Викликати `langFromPath(virtualPath || 'scan.ts')` → отримати `lang`.
2. Викликати `parseSync(virtualPath, content, { lang, sourceType: 'module' })` у `try/catch`. У `catch` → `return []`.
3. Якщо `result.errors?.length` → `return []` (парсер повернув помилки).
4. Викликати `walkAstWithAncestors(result.program, [], visitor)` з тим чи іншим visitor.
5. Повернути накопичений масив `out`.

### Особливості окремих сканерів

- **`findMssqlPerRequestConnectionInText`** додатково перевіряє, що поточний вузол знаходиться всередині функції: `ancestors.some(isFunctionNode)`. Без цього global-declaration `const pool = new sql.ConnectionPool(...)` помилково попадало б у порушення (а це якраз бажаний патерн).
- **`findUnsafeMssqlInListUnparsedInText`** перед обходом збирає всі `VariableDeclarator` (`collectVariableDeclarators`), щоб у `isInListExpressionParsed` мати можливість трасувати Identifier → init (рекурсивно). `seen` Set захищає від циклів виду `let a = b; let b = a;`.
- **`findUnsafeMssqlInListMissingEmptyGuardInText`** використовує `ancestors` усередині visitor: `findEnclosingBlockAndStatementIndex(ancestors)` дає пару `(block, statementIndex)`, після чого `hasEmptyGuardBefore(block, statementIndex, name)` перевіряє наявність guard у тому ж блоці **до** statement, що містить запит.

### Як викликати

```javascript
import {
  findMssqlPerRequestConnectionInText,
  findSharedMssqlRequestInText,
  findUnsafeMssqlDynamicSqlListInText,
  findUnsafeMssqlInListMissingEmptyGuardInText,
  findUnsafeMssqlInListUnparsedInText,
  findUnsafeMssqlQueryTemplateCallInText,
  isMssqlScanSourceFile
} from './mssql-pool-scan.mjs'

import { readFileSync } from 'node:fs'

const relPath = 'pkg/src/db.ts'
if (!isMssqlScanSourceFile(relPath)) return

const content = readFileSync(relPath, 'utf8')

const violationsPool = findMssqlPerRequestConnectionInText(content, relPath)
const violationsQuery = findUnsafeMssqlQueryTemplateCallInText(content, relPath)
const violationsShared = findSharedMssqlRequestInText(content, relPath)
const violationsJoin = findUnsafeMssqlDynamicSqlListInText(content, relPath)
const violationsUnparsed = findUnsafeMssqlInListUnparsedInText(content, relPath)
const violationsGuard = findUnsafeMssqlInListMissingEmptyGuardInText(content, relPath)

// Кожен елемент:
//   { line, snippet }  — для перших пʼяти
//   { line, snippet, reason, name? } — для останнього
```

### Приклади того, що ловить кожен сканер

#### `findMssqlPerRequestConnectionInText`

Порушення:

```javascript
export async function handler() {
  const pool = new sql.ConnectionPool(config) // створення на кожен запит
  await pool.connect()
}
```

Не порушення (модульний singleton):

```javascript
const pool = new sql.ConnectionPool(config) // на рівні модуля
```

#### `findUnsafeMssqlQueryTemplateCallInText`

Порушення:

```javascript
await pool.request().query(`SELECT * FROM users WHERE id = ${userId}`)
// це звичайний CallExpression з TemplateLiteral → SQL injection
```

Не порушення (tagged template):

```javascript
await pool.request().query`SELECT * FROM users WHERE id = ${userId}`
```

#### `findSharedMssqlRequestInText`

Порушення:

```javascript
export const request = pool.request()
// або
const request = somePool.request()
```

#### `findUnsafeMssqlDynamicSqlListInText`

Порушення:

```javascript
await sql.query`SELECT * FROM t WHERE id IN (${ids.join(',')})`
// .join(',') у списку IN/VALUES
```

#### `findUnsafeMssqlInListUnparsedInText`

Порушення:

```javascript
await sql.query`SELECT * FROM t WHERE id IN (${ids})`
// expr=ids, init=ids не пройшов parseInt/Number/BigInt/+
```

Не порушення:

```javascript
const ids = rawIds.map(x => parseInt(x, 10)).filter(Number.isFinite)
await sql.query`SELECT * FROM t WHERE id IN (${ids})`
// у піддереві ids є parseInt → subtreeHasNumericParseCall === true
```

#### `findUnsafeMssqlInListMissingEmptyGuardInText`

Порушення (`not_var` — вираз не Identifier):

```javascript
await sql.query`SELECT * FROM t WHERE id IN (${rawIds.map(Number)})`
```

Порушення (`missing_guard` — немає `if (!ids.length) throw`):

```javascript
async function load(ids) {
  await sql.query`SELECT * FROM t WHERE id IN (${ids})`
}
```

Не порушення:

```javascript
async function load(ids) {
  if (!ids.length) throw new Error('empty')
  await sql.query`SELECT * FROM t WHERE id IN (${ids})`
}
```

### Контракти та обмеження

- На синтаксично некоректному файлі **усі** сканери мовчки повертають `[]` — це навмисна стратегія, щоб не блокувати CI на парсинг-помилках (їх виявить лінт).
- Імпорт-Identifier-и не вважаються «парсованими» (немає видимого `init`), тож `findUnsafeMssqlInListUnparsedInText` для `import { ids } from '...'` дасть порушення — це консервативна поведінка.
- `isFunctionNode`/`isJoinCall`/`isSqlListContextTemplate` визначені у `ast-scan-utils.mjs`; зміни їхньої поведінки впливають на семантику цього модуля.
- Параметр `virtualPath` керує тільки вибором мови парсера. Якщо передати `.tsx`, парсер прийме JSX/TSX-синтаксис; для `.js` — звичайний JS і так далі.

### Точки розширення

- Додати новий клас порушень → ще одна функція `findX...InText(content, virtualPath)` + один visitor для `walkAstWithAncestors`.
- Розширити перелік числових парсерів → додати імʼя до `NUMERIC_PARSE_FN_NAMES`.
- Розширити форми guard-у → доповнити `isEmptyListTest` / `EMPTY_LIST_BINARY_OPERATORS` (наприклад додати `length < 1` через спеціальну гілку, бо поточна реалізація з `isZeroLiteral` цей варіант не покриває).

---

## Rebuild Test

Файл `mssql-pool-scan.mjs` можна повністю відтворити з цієї документації за такими опорними точками:

- Модуль ESM (`.mjs`), імпортує `parseSync` із `oxc-parser` і 7 утиліт із `../../../scripts/utils/ast-scan-utils.mjs` (`isFunctionNode`, `isJoinCall`, `isSqlListContextTemplate`, `langFromPath`, `normalizeSnippet`, `offsetToLine`, `walkAstWithAncestors`).
- Експортує 7 функцій (6 сканерів + `isMssqlScanSourceFile`) з підписами, описаними в розділі **Експорти / API** і **Функції**.
- Внутрішні константи: `SOURCE_FILE_RE`, `IN_PLACEHOLDER_END_RE`, `NUMERIC_PARSE_FN_NAMES`, `EMPTY_LIST_BINARY_OPERATORS`, `EMPTY_LIST_REVERSED_OPERATORS` — з точними значеннями з розділу **Залежності → Константи модуля**.
- Каркас сканера: `try { parseSync(...) } catch { return [] }`, далі `if (result.errors?.length) return []`, далі `walkAstWithAncestors(result.program, [], visitor)`, далі `return out`.
- Семантика visitor-ів — як описано в розділі **Функції → Експортовані функції** та **Збирачі порушень для `IN (...)` сканерів**.
- Допоміжні предикати (`isZeroLiteral`, `isLengthMemberOf`, `isEmptyListBinaryTest`, `isEmptyListTest`, `consequentHasThrow`, `hasEmptyGuardBefore`, `findEnclosingBlockAndStatementIndex`, `isNewConnectionPool`, `isUnsafeQueryCallWithTemplateLiteral`, `isRequestFactoryCall`, `isLiteralNumericArrayExpression`, `isNumericParseCallExpression`, `subtreeHasNumericParseCall`, `collectVariableDeclarators`, `quasiRawText`, `isInListExpressionParsed`, `collectInListUnparsedFromTemplate`, `collectInListMissingEmptyGuardFromTemplate`) — з контрактами, описаними в розділі **Приватні допоміжні функції**.
