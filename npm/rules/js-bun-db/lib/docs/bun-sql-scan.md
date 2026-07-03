---
type: JS Module
title: bun-sql-scan.mjs
resource: npm/rules/js-bun-db/lib/bun-sql-scan.mjs
docgen:
  crc: fad96162
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

AST-сканер виявляє небезпечні патерни, пов'язані з використанням Bun SQL та PostgreSQL. Він перевіряє, чи не створюється пул з'єднань через `new SQL` всередині функції, що порушує принцип singleton на рівні модуля. Сканер також виявляє виклики `<obj>.unsafe` без відповідного маркера-коментаря `// allow-unsafe: <reason>`, що заборонено за замовчуванням для `sql.unsafe`. Крім того, він ідентифікує динамічні SQL-списки у tagged template `sql\`... IN (${arr.join}) ...\``, які не використовують параметризовані значення, а також шукає інші аномалії у використанні бібліотек `pg` (js-bun-db.mdc).

## Поведінка

findPgFormatShimDefinitionInText знаходить визначення pg-format-сумісних шимів у коді, що використовує Bun SQL.
findPgFormatLikeQueryWrapperInText знаходить pg-сумісні обгортки запитів виду `{ query { ... unsafe ... } }` у коді, що використовує Bun SQL.
findBunSqlPerRequestConnectionInText знаходить створення нового екземпляра `SQL` всередині функцій, що вказує на неоптимальне використання пулу.
findBunSqlUnsafeUseWithoutAllowMarkerInText знаходить виклики `<obj>.unsafe` без відповідного маркера-коментаря.
findBunSqlUnsafeWithInterpolatedTemplateInText знаходить виклики `<obj>.unsafe` з інтерпольованим шаблоном, що створює структурну вразливість.
findBunSqlPgLeftoverCallInText знаходить виклики `<obj>.connect` або `<obj>.end` у файлах з Bun SQL без маркера-коментаря.
findUnsafeBunSqlDynamicSqlListInText знаходить динамічні SQL-списки у tagged template, де використовується `.join` замість параметризації.
findUnsafeBunSqlInListMissingEmptyGuardInText знаходить підстановки списків у `IN (...)`, де відсутня перевірка на пустоту з `throw`.
textHasBunSqlImport визначає, чи містить текст джерела імпорт імені `sql` або `SQL` з `"bun"`.
textHasPgLibImport визначає, чи імпортує файл npm-пакет `pg` за допомогою `import` або `require`.
findPgLibImportInText знаходить конкретні місця імпорту пакета `pg` у коді.
findPgListenNotifyUsageInText знаходить використання PostgreSQL LISTEN/NOTIFY у коді, що вимагає клієнта `pg`.
isBunSqlScanSourceFile визначає, чи підходить файл за розширенням для AST-скану.
findJsonStringifyBeforeJsonbInText знаходить виклики `JSON.stringify` перед використанням `::jsonb` у SQL template literal-ах, що призводить до подвійної серіалізації.
findSqlArrayWithoutTypeArgInText знаходить виклики `sql.array` або аналогічні, де відсутній другий аргумент (тип).

## Публічний API

findPgFormatShimDefinitionInText — Виявляє визначення pg-format-сумісних шимів. Прапорує функції з іменами, що вказують на форматування (`format`, `pgFormat`, `sqlFormat`, `pgFmt`), якщо їхній вміст містить літерали або регулярні вирази з `%L`, `%I`, `%s`. Також виявляє pg-format-специфічні API (`quoteLiteral`, `quoteIdent`, `escapeLiteral`, `escapeIdent`), які не потрібні при використанні Bun SQL.

findPgFormatLikeQueryWrapperInText — Виявляє pg-сумісні обгортки запитів, які маскують виклик `unsafe` під безпечне ім'я, повертаючи потенційну точку для SQL-ін'єкції.

findBunSqlPerRequestConnectionInText — Виявляє створення нового об'єкта SQL (`new SQL`) всередині функцій-обробників запитів, замість використання єдиного екземпляра.

findBunSqlUnsafeUseWithoutAllowMarkerInText — Виявляє виклики `unsafe` без відповідного маркера-коментаря. Забороняє використання `unsafe`, якщо значення не контролюється кодом (не вхідні дані користувача) і не є необхідним для підстановки назв таблиць/колонок або динамічного SQL/DDL.

findBunSqlUnsafeWithInterpolatedTemplateInText — Виявляє використання `unsafe` з шаблонним літералом, що містить інтерполяцію (`${name}`). Попереджає, що шаблонна підстановка не екранує ідентифікатори та не прив'язує значення, створюючи ризик структурної ін'єкції.

findBunSqlPgLeftoverCallInText — Виявляє виклики `connect` або `end` для pg-клієнта у файлах, що імпортують Bun SQL, без відповідного маркера-коментаря.

findUnsafeBunSqlDynamicSqlListInText — Виявляє динамічні SQL-списки у контекстах `IN (...)` або `VALUES (...)`, де використовується метод `.join` серед виразів.

findUnsafeBunSqlInListMissingEmptyGuardInText — Виявляє підстановки списків у `IN (...)`, які або не винесені в окрему змінну, або винесені, але перед запитом відсутня перевірка на порожній список.

textHasBunSqlImport — Перевіряє, чи містить текст джерела імпорт імені `sql` або `SQL` з модуля `"bun"`.

textHasPgLibImport — Перевіряє, чи імпортує файл бібліотеку `pg` (саме клієнт, а не `pg-format` чи `@types/pg`).

findPgLibImportInText — Знаходить явний імпорт пакета `pg` у коді, повертаючи місце виявлення для точного відображення у повідомленнях про помилку.

findPgListenNotifyUsageInText — Виявляє використання PostgreSQL команд `LISTEN`/`NOTIFY` у запитах або обробниках подій, оскільки Bun SQL поки не підтримує ці функції.

findJsonStringifyBeforeJsonbInText — Знаходить виклики `JSON.stringify::jsonb` у SQL-шаблонах, що призводить до подвійної серіалізації даних.

findSqlArrayWithoutTypeArgInText — Знаходить виклики функції для створення масиву (`sql.array` тощо) без вказання обов'язкового другого аргументу (типу pg-елемента), що може спричинити невідповідність типів.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
