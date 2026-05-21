# Дозвіл `@scaleleap/pg-format` для динамічних SQL-identifiers у правилі js-bun-db

**Status:** Accepted
**Date:** 2026-05-19

## Context and Problem Statement
Правило `js-bun-db.mdc` (v1.8) повністю забороняло `pg-format` і будь-які функції з плейсхолдерами `%L`/`%I`/`%s`, вимагаючи використовувати виключно Bun native SQL. Проте Bun SQL не може безпечно вставляти динамічні SQL-identifiers (назви schema, table, column, index, role, database) — лише значення через `$N`-параметри. Для таких випадків правило не пропонувало безпечної альтернативи.

## Considered Options
* Дозволити `@scaleleap/pg-format` (scoped) для динамічних identifiers (`%I`) і whitelist-значень (`%s`), залишивши `%L` для структурних потреб, але зберігши заборону unscoped `pg-format` і передавання значень через `%L`/`%s` поза whitelist
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Дозволити `@scaleleap/pg-format` (scoped) для динамічних identifiers та whitelist-значень", because `format('%I', name)` є єдиним способом безпечного екранування SQL-identifier без template string interpolation, що `sql.unsafe(...)` з інтерполяцією не гарантує.

### Consequences
* Good, because `format('%I', schema)` + `sql.unsafe(query, [bindParams])` дозволяє будувати динамічні запити (ORDER BY, multi-row INSERT, dynamic WHERE) без ручного екранування і без ризику SQL-injection через identifier.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Змінений файл: `npm/rules/js-bun-db/js-bun-db.mdc` — нова секція «Динамічна SQL-структура: `@scaleleap/pg-format` для identifiers», таблиця дозволених патернів (`%I`, `%s`, `$N`), приклади динамічного `ORDER BY` із whitelist, multi-row `INSERT VALUES %L`, dynamic `WHERE` через `$N`.
- `npm/rules/js-bun-db/policy/package_json/template/package.json.deny.json` — не змінювався; unscoped `pg-format` залишається у denylist.
- `npm/scripts/utils/bun-sql-scan.mjs` — не змінювався; сканер флагує лише власноруч визначені функції-шими з `%L`/`%I`/`%s` у тілі, зовнішній імпорт `@scaleleap/pg-format` він не чіпає.
- Версія правила: `1.8` → `1.9`; пакет: `1.13.54` → `1.13.55` (`npm/package.json`, `npm/CHANGELOG.md`).
- Перевірка: `npx @nitra/cursor check js-bun-db` — ✅; `cd npm && bun test` — 779 pass / 0 fail.
