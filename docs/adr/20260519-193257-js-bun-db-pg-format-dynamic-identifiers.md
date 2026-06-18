---
type: ADR
title: "Дозвіл `@scaleleap/pg-format` для динамічних SQL-identifiers у правилі js-bun-db"
---

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

## Update 2026-05-19

### Дозвіл `@scaleleap/pg-format` для dynamic identifiers (уточнення)

unscoped `pg-format` лишається у `package.json.deny.json`; `@scaleleap/pg-format` дозволено виключно для identifiers (`%I`) та whitelist (`%s`). AST-сканер `bun-sql-scan.mjs` детектує лише внутрішні функції-шими з `%L`/`%I`/`%s` у тілі — зовнішній `@scaleleap/pg-format` не флагується. Нова секція «Динамічна SQL-структура: `@scaleleap/pg-format` для identifiers» у `js-bun-db.mdc` v1.9 з таблицею рішень та ❌/✅-прикладами.

### Виключення `pg` для LISTEN/NOTIFY

Chosen option: "AST-детектор: `pg` дозволений лише у файлах з LISTEN/NOTIFY", because Bun SQL не підтримує `LISTEN`/`NOTIFY`/`UNLISTEN`; звичайні SELECT/INSERT/UPDATE через `pg` залишаються забороненими.

- Good, because check дає точний fail-сигнал: «`import 'pg'` у файлі без LISTEN/NOTIFY».
- Bad, because AST-детектор покриває лише `<obj>.query('LISTEN…')`, `<obj>.on('notification', …)` та tagged literal — екзотичніші паттерни не детектуються (false-negative).

Змінені файли: `bun-sql-scan.mjs` (нові експорти `textHasPgLibImport`, `findPgLibImportInText`, `findPgListenNotifyUsageInText`); `npm/rules/js-bun-db/fix/safety/check.mjs` (`checkPgDependencyAndUsage`); `package.json.deny.json` (`pg` прибрано); `js-bun-db.mdc` v1.10; 5 нових тестів у `check.test.mjs`.

### Hard ban `sql.unsafe(TemplateLiteral з expressions)` навіть з маркером

Chosen option: "Hard ban `sql.unsafe(TemplateLiteral з expressions)` навіть з маркером", because маркер `allow-unsafe` не усуває ризик injection через JS template interpolation; identifier-escaping має відбуватись через `format('%I', ...)`.

- Good, because identifiers гарантовано проходять через `pg-format`-escape, а не через сирий JS template string.
- Bad, because transcript не містить підтверджених негативних наслідків.

Новий експорт `findBunSqlUnsafeWithInterpolatedTemplateInText` у `bun-sql-scan.mjs`; `js-bun-db.mdc` v1.11 з підсекцією «`sql.unsafe` з template-літералом і `${...}`-інтерполяцією — заборонено навіть з маркером»; 2 нових тести у `check.test.mjs`.
