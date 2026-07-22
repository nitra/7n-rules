---
type: JS Module
title: bun-sql-scan.mjs
resource: plugins/lang-js/rules/js-bun-db/lib/bun-sql-scan.mjs
docgen:
  crc: 033da74d
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 100
  issues: judge-refine:kept-original,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Сканер аналізує AST у JS/TS-файлах через `oxc-parser` і шукає конкретні небезпечні патерни для `import { sql, SQL } from 'bun'`: `new SQL` всередині функції, виклики `sql.unsafe` без маркера `// n-rules:allow-unsafe: <reason>`, а також динамічні списки в tagged template, де потрібне `sql`, а не готовий SQL-фрагмент. Окремо враховуються винятки для `pg` і `LISTEN/NOTIFY`, щоб дозволені сценарії не маскували справжні ризики. Якщо файл не парситься або містить синтаксичні помилки, перевірка повертає порожній результат.

## Поведінка

Скан запускається лише для JS/TS-файлів, придатних для AST-проходу, і лише там, де є Bun SQL-імпорт; якщо джерело не парситься або має синтаксичну помилку, перевірка нічого не повертає, щоб не маскувати проблему коду.

findPgLibImportInText і textHasPgLibImport дають дешевий і точний сигнал, що файл уже використовує `pg`, а findPgListenNotifyUsageInText окремо відсіює випадки, де PostgreSQL потрібен як виняток через LISTEN/NOTIFY.

findPgFormatShimDefinitionInText та findPgFormatLikeQueryWrapperInText шукають сумісні з `pg` шими й обгортки, які можуть приховувати небезпечний SQL-потік під безпечними назвами; такі знахідки потрібні, щоб міграція на Bun SQL не залишала старі поверхні інʼєкції непоміченими.

findBunSqlPerRequestConnectionInText, findBunSqlUnsafeUseWithoutAllowMarkerInText і findBunSqlUnsafeWithInterpolatedTemplateInText працюють як основний захист: перша ловить створення SQL-пулу в межах обробника замість singleton на рівні модуля, друга вимагає явного маркера для кожного unsafe-виклику, а третя блокує вставку інтерполяції в unsafe навіть із маркером, бо це все ще структурно небезпечно. Маркери повідомлень у (js-bun-db.mdc) використовуються як opt-in і завжди мають стояти безпосередньо біля виклику.

findBunSqlPgLeftoverCallInText відсікає зайві `connect`/`end` у файлах із Bun SQL-імпортом, а findUnsafeBunSqlDynamicSqlListInText та findUnsafeBunSqlInListMissingEmptyGuardInText охороняють шаблонні списки: перша не дає пропустити `join` усередині SQL-списків, друга вимагає винести `IN`-значення в змінну й поставити guard на порожній список перед запитом.

findJsonStringifyBeforeJsonbInText і findSqlArrayWithoutTypeArgInText ловлять ще два небезпечні переходи між JS і SQL: подвійне JSON-serializing перед `::jsonb` та масиви без вказаного елементарного типу, які ламають очікуваний pg-тип і дають неправильний запит.

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
