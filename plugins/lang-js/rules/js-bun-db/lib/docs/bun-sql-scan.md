---
type: JS Module
title: bun-sql-scan.mjs
resource: plugins/lang-js/rules/js-bun-db/lib/bun-sql-scan.mjs
docgen:
  crc: fd70e9dc
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 80
---

## Огляд

AST-сканер небезпечних патернів Bun SQL (`import { sql, SQL } from 'bun'`).

Знаходить:
- `new SQL(...)` всередині функції — пул має бути singleton на рівні модуля,
  а не на кожен виклик handler-а.
- Будь-який виклик `<obj>.unsafe(...)` без маркера-коментаря `// n-rules:allow-unsafe: <reason>`
  на тому ж рядку або рядком вище. `sql.unsafe` за замовчуванням заборонено: дозволено
  тільки якщо значення контролюється кодом (не user input) і потрібно підставити
  назву таблиці/колонки або dynamic SQL/DDL. Інакше — переробити на tagged template
  `sql\`...\${value}...\``. Маркер фіксує цю причину для ревʼюера.
- Динамічні SQL-списки у tagged template `sql\`... IN (${arr.join(',')}) ...\``:
  навіть «через tagged template» у запит потрапляє готовий шматок SQL замість
  параметризованих значень — треба `sql([...])`.

Семантика — через **oxc-parser**, без regex по тексту коду.
Якщо файл не парситься / містить синтаксичні помилки — повертаємо порожній
результат: спочатку треба полагодити синтаксис, потім перезапустити перевірку.

## Публічний API

- findPgFormatShimDefinitionInText — Знаходить визначення pg-format-сумісних шимів у джерелі. Прапорує:
- функції з іменами `format` / `pgFormat` / `sqlFormat` / `pgFmt`, у тілі яких
  зустрічається літерал/regex з `%L` / `%I` / `%s` — це drop-in pg-format;
- функції з іменами `quoteLiteral` / `quoteIdent` / `escapeLiteral` / `escapeIdent`
  незалежно від тіла — це pg-format-специфічні API, не потрібні з Bun SQL.

Скан запускається лише в файлах, де є `import { sql|SQL } from 'bun'`, щоб
не плутати, наприклад, форматер дат чи URL-escape з SQL-шимом.
- findPgFormatLikeQueryWrapperInText — Знаходить pg-сумісні query-обгортки виду
`{ query(text, params) { return <sql>.unsafe(text, params) } }`
у файлах, що імпортують Bun SQL. Така обгортка маскує `unsafe` під
«безпечним» ім'ям і повертає injection-поверхню в код.

Спрацьовує, коли всі умови виконані:
- вузол — `Property` з `key.name === 'query'` всередині `ObjectExpression`;
- значення — функція з 1–2 параметрами, перший — Identifier з типовим
  pg-іменем (`text` / `sql` / `query`);
- у тілі функції є виклик `<obj>.unsafe(...)`.
- findBunSqlPerRequestConnectionInText — Знаходить `new SQL(...)` всередині функцій (handler на кожен запит замість singleton).
- findBunSqlUnsafeUseWithoutAllowMarkerInText — Знаходить виклики `<obj>.unsafe(...)` без маркера-коментаря `// n-rules:allow-unsafe: <reason>`
на тому ж рядку або рядком вище. `sql.unsafe` за замовчуванням заборонено: дозволено
лише коли значення контролюється кодом (не user input) і потрібно підставити те, що
не можна параметризувати — назву таблиці/колонки або dynamic SQL/DDL. У всіх інших
випадках — переробити на tagged template виду `sql` із інтерполяцією значень.
Маркер-коментар фіксує причину для ревʼюера й одночасно слугує opt-in: без нього
перевірка падає, навіть якщо у `unsafe` лежить статичний рядок без інтерполяції.
- findBunSqlUnsafeWithInterpolatedTemplateInText — Знаходить `<obj>.unsafe(template_literal_with_interpolation)` — навіть із маркером
`// n-rules:allow-unsafe`. Шаблонна підстановка `${name}` у `sql.unsafe`-рядок **не екранує**
identifier'ів (reserved words, спецсимволи) і ніяк не біндить значення — це
структурна injection-поверхня, яку легко не помітити в ревʼю. Канон — побудувати
`text` через `@scaleleap/pg-format` `format('%I', name)` (для identifiers) або
звичайні позиційні `$N`-placeholder'и (для values), і передати в `sql.unsafe(text, [params])`.

Прапорує саме `TemplateLiteral` з `expressions.length > 0`; статичні рядки
(`Literal`, `StringLiteral`, `TemplateLiteral` без `${...}`) і виклики з готовим
`text` як змінною — не зачіпає (для них діє основна перевірка n-rules:allow-unsafe).
- findBunSqlPgLeftoverCallInText — Знаходить pg-leftover виклики `<obj>.connect(...)` / `<obj>.end(...)` без маркера
`// n-rules:allow-pg-leftover: <reason>` у файлах, де **в цьому ж файлі** є `import { sql|SQL } from 'bun'`.

Скоп навмисно вузький: ці метод-імена занадто загальні (WebSocket, Stream, інші бібліотеки),
тож сканер обмежений файлами, що вже використовують Bun SQL — там pg-залишок є явним
багом міграції. У не-Bun-SQL файлах прапоратися не буде, навіть якщо проєкт у цілому
мігрував.
- findUnsafeBunSqlDynamicSqlListInText — Знаходить динамічні SQL-списки у TaggedTemplateExpression / TemplateLiteral в контексті
`IN (...)` або `VALUES (...)`, де серед expressions є виклик `.join(...)`.
- findUnsafeBunSqlInListMissingEmptyGuardInText — Знаходить підстановки списків у `IN (...)`, які:
- не винесені в окрему змінну (в `${...}` стоїть не Identifier або `sql(<non-Identifier>)`);
- або винесені, але перед запитом немає перевірки на пустоту з `throw`.
- textHasPgLibImport — Чи імпортує файл npm-пакет `pg` (`import ... from 'pg'` або `require('pg')`).
Текстова перевірка — без AST, дешевий pre-filter; для строгої локалізації
(рядок/snippet) використай `findPgLibImportInText`. Не матчить `pg-format`,
`pg-pool`, `@types/pg` — лише сам клієнт.
- findPgLibImportInText — Знаходить ImportDeclaration / CallExpression `require('pg')` для пакета `pg`
(саме точна назва, не `pg-format` тощо). Повертає рядок і snippet — щоб у
повідомленнях `fail` показати конкретне місце.
- findPgListenNotifyUsageInText — Знаходить використання PostgreSQL LISTEN/NOTIFY у коді — сигнал, що проект
потребує `pg` як виняток (Bun SQL поки не реалізує LISTEN/NOTIFY). Прапорує:
- `<obj>.query(...)` / `<obj>.queryArray(...)` / `<obj>.queryStream(...)`, де
  перший аргумент — string literal або template literal, що починається з
  `LISTEN ` / `UNLISTEN ` / `NOTIFY ` (case-insensitive);
- `<obj>.on('notification', ...)` — pg-listener notification-подій (другий
  аргумент — функція; перший — точно рядок `'notification'`);
- TaggedTemplateExpression виду sql tagged template з LISTEN/UNLISTEN/NOTIFY
  на початку першого quasi — на випадок, якщо хтось використовує Bun
  SQL-tagged-template, а LISTEN/NOTIFY все одно лишається у тексті запиту
  (це не запрацює у Bun SQL, але як сигнал — приймаємо).

Регістр SQL-слів не важливий, провідні пробіли допускаються.
- isBunSqlScanSourceFile — Чи сканувати цей файл за розширенням (JS/TS-сімʼя, без `.d.ts`).
- findJsonStringifyBeforeJsonbInText — Знаходить виклики `JSON.stringify(...)::jsonb` всередині SQL template literal-ів.
Bun SQL серіалізує об'єкти/масиви у JSON автоматично — явний `JSON.stringify`
перед `::jsonb` призводить до подвійної серіалізації (js-bun-db.mdc).
- findSqlArrayWithoutTypeArgInText — Знаходить виклики `sql.array(arr)` / `pgWrite.array(arr)` / `pgRead.array(arr)` без
обов'язкового другого аргументу (типу pg-елемента). Без типу Bun не може вивести
pg-тип, що призводить до mismatch (js-bun-db.mdc).

## Сценарії використання

- `plugins/lang-js/rules/js-bun-db/lib/tests/bun-sql-scan.test.mjs` (isBunSqlScanSourceFile; textHasBunSqlImport) — true для .mjs, .ts, .tsx, .cjs; false для .d.ts (декларації); false для нерелевантних розширень; true для .js (base case); true для import { sql } from; ще 66

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
