---
type: JS Module
title: bun-sql-scan.mjs
resource: plugins/lang-js/rules/js-bun-db/lib/bun-sql-scan.mjs
docgen:
  crc: 9b920f97
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

AST-сканер для Bun SQL (`import { sql, SQL } from 'bun'`) знаходить патерни, небезпечні для міграції, через `oxc-parser`, без regex по тексту коду. Він виявляє `new SQL` всередині функції, бо пул підключень має бути module-level singleton, а не створюватися на кожен виклик handler-а.

Сканер забороняє будь-який `<obj>.unsafe` без маркера `// n-rules:allow-unsafe: <reason>` на тому ж або попередньому рядку. Виняток має бути явно пояснений для ревʼю: `unsafe` допустимий лише для контрольованих кодом SQL-ідентифікаторів або dynamic SQL/DDL, а не для user input.

Також сканер знаходить залишки `pg`, небезпечні SQL-списки на кшталт `arr.join` у tagged template, випадки без `sql`, JSONB-серіалізацію та масиви без явного pg-типу. Якщо файл не парситься або має syntax errors, результат порожній: спочатку треба виправити синтаксис і повторити перевірку.

## Поведінка

Сканування починається з відбору файлів через isBunSqlScanSourceFile або дешевих текстових попередніх фільтрів на кшталт textHasPgLibImport. Далі публічні пошукові функції отримують вихідний текст, будують AST і повертають списки знахідок із рядком та фрагментом коду; якщо код не парситься, результат порожній, бо синтаксис має бути виправлений до повторної перевірки.

findBunSqlPerRequestConnectionInText, findBunSqlUnsafeUseWithoutAllowMarkerInText, findBunSqlUnsafeWithInterpolatedTemplateInText, findBunSqlPgLeftoverCallInText, findUnsafeBunSqlDynamicSqlListInText, findUnsafeBunSqlInListMissingEmptyGuardInText, findJsonStringifyBeforeJsonbInText і findSqlArrayWithoutTypeArgInText разом формують перевірки міграції на Bun SQL: вони ловлять створення пулу в runtime-шляху, небезпечний dynamic SQL, залишки pg-поведінки, некоректні списки, зайву JSON-серіалізацію та масиви без явного pg-типу. Маркери дозволу враховуються лише як локальний opt-in для ревʼю і повідомлень правила (js-bun-db.mdc), але не скасовують заборону на інтерпольовані unsafe-шаблони.

findPgFormatShimDefinitionInText і findPgFormatLikeQueryWrapperInText працюють як додатковий шар проти маскування старих pg-підходів: вони знаходять сумісні з pg-format шими та query-обгортки, які повертають injection-поверхню під безпечними назвами.

findPgLibImportInText деталізує місця імпорту pg після текстового сигналу від textHasPgLibImport, а findPgListenNotifyUsageInText позначає випадки LISTEN/NOTIFY як причину, чому pg може лишатися свідомим винятком під час міграції.

Усі результати залишаються в памʼяті та повертаються викликачеві для lint-повідомлень; файл не записує зміни у ФС чи БД.

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

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
