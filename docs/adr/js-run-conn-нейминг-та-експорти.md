# Нейминг і експорти файлів у `src/conn/`

**Status:** Accepted
**Date:** 2026-05-08

## Контекст

У backend Node.js проєктах підключення до баз даних і GraphQL-клієнтів виносяться в окремі файли `src/conn/`. Без єдиної конвенції назви файлів не повідомляли, до чого підключаємося і в якому режимі (репліка vs мастер), а `export default` унеможливлював автоматичний рефакторинг і пошук за іменем.

## Рішення/Процедура/Факт

До `npm/mdc/js-run.mdc` (версія 1.5 → 1.6) додано правила нейминг і експортів файлів `src/conn/`:

- GraphQL — префікс `ql-` + ідентифікатор endpoint: `ql-smart.js`, `ql-contract.js`.
- PostgreSQL — префікс `pg-` + тип підключення: `pg-read.js`, `pg-write.js`.
- PostgreSQL до кількох БД — додатковий ідентифікатор: `pg-read-smart.js`.
- MySQL/MSSQL — префікс `mysql-` за тією самою схемою.
- Заборонено `export default`; іменований експорт відповідає назві файла у camelCase (`ql-smart.js` → `export const qlSmart`).
- Якщо з назви змінної оточення не очевидний режим — аналізуємо SQL-операції: без `INSERT`/`UPDATE`/`DELETE`/DDL → `pg-read`, інакше → `pg-write`.

## Обґрунтування

Назва файла має одразу повідомляти, до чого і в якому режимі відбувається підключення. Іменований експорт за назвою файла дозволяє однозначно шукати використання та робити автоматизовані перевірки через `npx @nitra/cursor check js-run`.

## Розглянуті альтернативи

Альтернативи не розглядалися; конвенція продиктована вимогами проєкту.

## Зачіпає

`npm/mdc/js-run.mdc`; всі backend workspace-пакети, що мають каталог `src/conn/`.

## Update 2026-05-08

Додано утиліту `npm/scripts/utils/conn-file-rules.mjs` (AST-перевірка): валідує basename файла regex-ом, знаходить `export default` (порушення), збирає всі іменовані `export const`, порівнює з очікуваним camelCase-іменем від basename. Функцію `checkConnFileRules` інтегровано в `check-js-run.mjs` — обходить усі файли conn-каталога (крім `index.*`) та агрегує порушення. Розділ «Перевірка» у `js-run.mdc` оновлено: `npx @nitra/cursor check js-run` тепер явно описує перевірку basename, відсутності `export default` і відповідності імені іменованого експорту. Версія `npm/package.json` → `1.8.208`.

## Update 2026-05-09

### Додано префікс `mssql-` для з'єднань з Microsoft SQL Server

Регекс `CONN_FILENAME_RE` у `scripts/utils/conn-file-rules.mjs` розширено з `(?:pg|mysql)` до `(?:pg|mysql|mssql)`, що дозволяє використовувати окремий префікс `mssql-` для файлів підключення до MS SQL Server (наприклад, `mssql-read.ts`, `mssql-write-b2b.mts`). Раніше обидві СУБД — MySQL і MSSQL — могли використовувати префікс `mysql-`, що порушувало принцип «ім'я файла одразу повідомляє, до якої СУБД підключення».

Зміна backward-сумісна: проєкти, що вже використовують `mysql-…` для MSSQL-з'єднань, продовжують проходити валідацію без правок; `mssql-` є рекомендованим, але не обов'язковим префіксом для нового коду. `kebabToCamel` не потребував змін — він нечутливий до конкретного префіксу і коректно перетворює `mssql-write-b2b` → `mssqlWriteB2b`.

Відхилено: компактний варіант `m(y|s)?sql` (зловив би неіснуючий `msql-`) та alias `mssql-` → `mysql-` на рівні валідатора (маскує проблему замість вирішення). Зачіпає: `npm/scripts/utils/conn-file-rules.mjs`, `npm/scripts/check-js-run.mjs`, `npm/mdc/js-run.mdc`, `npm/tests/conn-file-rules.test.mjs`, `npm/tests/check-js-run-fixture.test.mjs`.
