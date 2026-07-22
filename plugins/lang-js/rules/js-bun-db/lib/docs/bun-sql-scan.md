---
type: JS Module
title: bun-sql-scan.mjs
resource: plugins/lang-js/rules/js-bun-db/lib/bun-sql-scan.mjs
docgen:
  crc: 409b0016
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
---

## Огляд

AST-сканер знаходить у JS/TS-коді небезпечні патерни Bun SQL через **`oxc-parser`**, без regex по тексту коду. Він виявляє `new SQL` у функції, бо пул має бути singleton на рівні модуля, виклики `unsafe` без маркера `// n-rules:allow-unsafe: <reason>` на тому ж рядку або рядком вище, а також ручні SQL-списки на кшталт `sql\`... IN (${arr.join}) ...\``, які треба замінювати на `sql`. Якщо файл не парситься або має синтаксичні помилки, сканер повертає порожній результат: спершу треба виправити синтаксис і повторити перевірку.

## Поведінка

Сканер приймає текст вихідного файлу й повертає списки знахідок із рядком та фрагментом коду для повідомлень правила. `isBunSqlScanSourceFile` відсікає файли поза JS/TS-сімʼєю та declaration-файли, щоб AST-перевірки запускалися лише там, де очікується виконуваний код.

Основний потік працює через AST-розбір: `findBunSqlPerRequestConnectionInText`, `findBunSqlUnsafeUseWithoutAllowMarkerInText`, `findBunSqlUnsafeWithInterpolatedTemplateInText`, `findBunSqlPgLeftoverCallInText`, `findUnsafeBunSqlDynamicSqlListInText`, `findUnsafeBunSqlInListMissingEmptyGuardInText`, `findJsonStringifyBeforeJsonbInText` і `findSqlArrayWithoutTypeArgInText` шукають небезпечні або міграційні патерни Bun SQL та віддають їх як порушення для правила (js-bun-db.mdc). Якщо код не парситься, результат порожній: синтаксис має бути виправлений до повторного запуску перевірки.

`findBunSqlUnsafeUseWithoutAllowMarkerInText` і `findBunSqlPgLeftoverCallInText` мають спільну модель opt-in винятків: локальний маркер має стояти безпосередньо біля виклику й фіксувати причину для ревʼю. `findBunSqlUnsafeWithInterpolatedTemplateInText` залишається суворішою перевіркою: інтерпольований dynamic SQL у `unsafe` вважається порушенням навіть за наявності маркера, бо створює injection-поверхню.

Перевірки списків розділяють дві різні небезпеки: `findUnsafeBunSqlDynamicSqlListInText` ловить готові SQL-фрагменти, зібрані зі списків, а `findUnsafeBunSqlInListMissingEmptyGuardInText` вимагає, щоб списки для `IN` були окремими змінними й мали guard на порожність перед запитом. Це захищає і від ручного складання SQL, і від некоректної поведінки на порожньому наборі значень.

Міграційні перевірки навколо `pg` працюють вузько, щоб не чіпати сторонні збіги. `textHasPgLibImport` дає дешевий текстовий pre-filter для точного імпорту клієнта `pg`, а `findPgLibImportInText` повертає конкретні місця імпорту. `findPgListenNotifyUsageInText` виділяє LISTEN/UNLISTEN/NOTIFY та listener подій як сигнал легітимної потреби в `pg`, бо Bun SQL не покриває цей сценарій.

`findPgFormatShimDefinitionInText` і `findPgFormatLikeQueryWrapperInText` шукають залишки pg-style API у файлах із Bun SQL: format/quote helper-и та query-обгортки, що приховують `unsafe` під безпечним на вигляд інтерфейсом. Їхній результат допомагає не переносити стару SQL-поверхню в новий Bun SQL код.

`findJsonStringifyBeforeJsonbInText` і `findSqlArrayWithoutTypeArgInText` фокусуються на runtime-сумісності Bun SQL: перша перевірка запобігає подвійній JSON-серіалізації перед `jsonb`, друга вимагає явного pg-типу для масивів, щоб уникнути mismatch під час виконання.

## Публічний API

- findBunSqlPerRequestConnectionInText — Знаходить `new SQL(...)` всередині функцій (handler на кожен запит замість singleton).
- findBunSqlUnsafeUseWithoutAllowMarkerInText — Знаходить виклики `<obj>.unsafe(...)` без маркера-коментаря `// n-rules:allow-unsafe: <reason>` на тому ж рядку або рядком вище; без маркера перевірка падає навіть на статичний рядок без інтерполяції.
- findBunSqlUnsafeWithInterpolatedTemplateInText — Знаходить `<obj>.unsafe(template_literal_with_interpolation)` — hard fail навіть із маркером `// n-rules:allow-unsafe`, бо підстановка `${name}` не екранує значення (injection-поверхня); канон — `@scaleleap/pg-format` `format('%I', name)` для identifiers або `$N`-placeholder'и для values.
- findBunSqlPgLeftoverCallInText — Знаходить pg-leftover виклики `<obj>.connect(...)` / `<obj>.end(...)` без маркера `// n-rules:allow-pg-leftover: <reason>` у файлах, де є `import { sql|SQL } from 'bun'` (скоп навмисно вузький — лише файли, що вже використовують Bun SQL).
- findUnsafeBunSqlDynamicSqlListInText — Знаходить динамічні SQL-списки у TaggedTemplateExpression / TemplateLiteral в контексті `IN (...)` або `VALUES (...)`, де серед expressions є виклик `.join(...)`.
- findUnsafeBunSqlInListMissingEmptyGuardInText — Знаходить підстановки списків у `IN (...)`, які не винесені в окрему змінну, або винесені, але перед запитом немає перевірки на пустоту з `throw`.
- textHasPgLibImport — Дешевий текстовий pre-filter: чи імпортує файл npm-пакет `pg` (не матчить `pg-format`/`pg-pool`/`@types/pg`).
- findPgLibImportInText — Знаходить ImportDeclaration / `require('pg')` для точного пакета `pg`, повертає рядок і snippet для повідомлень `fail`.
- findPgListenNotifyUsageInText — Знаходить використання PostgreSQL LISTEN/NOTIFY (query-виклики, `.on('notification', ...)`, sql tagged template) — сигнал легітимної потреби в `pg` (Bun SQL поки не реалізує LISTEN/NOTIFY).
- findPgFormatShimDefinitionInText — Знаходить визначення pg-format-сумісних шимів (`format`/`pgFormat`/`sqlFormat`/`pgFmt` з `%L`/`%I`/`%s`, або `quoteLiteral`/`quoteIdent`/`escapeLiteral`/`escapeIdent`) у файлах з Bun SQL import.
- findPgFormatLikeQueryWrapperInText — Знаходить pg-сумісні query-обгортки виду `{ query(text, params) { return <sql>.unsafe(text, params) } }`, що маскують `unsafe` під «безпечним» ім'ям.
- isBunSqlScanSourceFile — Чи сканувати цей файл за розширенням (JS/TS-сімʼя, без `.d.ts`).
- findJsonStringifyBeforeJsonbInText — Знаходить виклики `JSON.stringify(...)::jsonb` усередині SQL template literal-ів — Bun SQL серіалізує самостійно, явний виклик призводить до подвійної серіалізації.
- findSqlArrayWithoutTypeArgInText — Знаходить виклики `sql.array(arr)` / `pgWrite.array(arr)` / `pgRead.array(arr)` без обов'язкового другого аргументу (типу pg-елемента), інакше Bun не може вивести pg-тип.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
