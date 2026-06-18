---
type: JS Module
title: safety.mjs
resource: npm/rules/js-bun-db/js/safety.mjs
docgen:
  crc: eaeb52bc
  score: 100
---

Огляд

Файл перевіряє шляхи до файлів та залежностей, пов'язаних з Bun SQL та бібліотекою `pg`. Файл збирає метадані про використання `pg` та механізми LISTEN/NOTIFY. (js-bun-db.mdc)

## Поведінка

1. Завантажити шляхи до файлів з коду
2. Просканувати джерела за патернами Bun SQL
3. Зібрати метадані про використання `pg` та LISTEN/NOTIFY
4. Перевірити залежності `pg` та використання LISTEN/NOTIFY
5. Перевірити імпорти `pg` та використання LISTEN/NOTIFY
6. Перевірити наявність `package.json` для залежностей `pg`
7. Перевірити використання `import { sql|SQL } from 'bun'`
8. Перевірити відсутність створення `new SQL` всередині функцій
9. Перевірити використання `sql.unsafe` без маркерів дозволу
10. Перевірити використання `sql.unsafe` з template-літералами
11. Перевірити використання `pg-leftover` викликів
12. Перевірити використання `findBunSqlUnsafeBunSqlDynamicSqlListInText`
13. Перевірити використання `findUnsafeBunSqlInListMissingEmptyGuardInText`
14. Перевірити використання `findPgFormatShimDefinitionInText`
15. Перевірити використання `findPgFormatLikeQueryWrapperInText`
16. Перевірити наявність використання `import { sql } from 'bun'`

## Публічний API

check — Перевіряє відповідність проєкту правилу js-bun-db.mdc

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- Не звертається до мережі.
