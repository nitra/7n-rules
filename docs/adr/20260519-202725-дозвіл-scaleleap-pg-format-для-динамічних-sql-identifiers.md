---
session: 42cde201-dd0f-44a6-b798-9ed0619a0fbd
captured: 2026-05-19T20:27:25+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/42cde201-dd0f-44a6-b798-9ed0619a0fbd.jsonl
---

## ADR Дозвіл `@scaleleap/pg-format` для динамічних SQL identifiers

## Context and Problem Statement
Правило `js-bun-db` повністю забороняло будь-яке ручне форматування SQL через `pg-format`/шими. Але Bun SQL tagged templates не можуть підставляти динамічні identifiers (назви schema, table, column, index, role, database) — тільки values; `%I`-escape не має нативного аналога.

## Considered Options
* Залишити заборону на `pg-format` повністю, дозволити `sql.unsafe(...)` з `// allow-unsafe` маркером для dynamic identifiers
* Дозволити scoped `@scaleleap/pg-format` виключно для identifiers (`%I`) та whitelist (`%s`), values — тільки через Bun SQL `$N` parameters

## Decision Outcome
Chosen option: "Дозволити scoped `@scaleleap/pg-format` виключно для identifiers та whitelist", because unscoped `pg-format` лишається у denylist (`package.json.deny.json`), а `@scaleleap/pg-format` не флагується AST-сканером `bun-sql-scan.mjs` (він детектує лише внутрішні функції-шими з `%L`/`%I`/`%s` у тілі).

### Consequences
* Good, because transcript фіксує очікувану користь: identifiers коректно екрануються через `format('%I', name)` замість небезпечної template-інтерполяції в `sql.unsafe()`; правило покриває dynamic `ORDER BY`, multi-row `INSERT VALUES %L`, dynamic `WHERE` через `$N`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/rules/js-bun-db/js-bun-db.mdc` v1.9: нова секція «Динамічна SQL-структура: `@scaleleap/pg-format` для identifiers» з таблицею рішень та ❌/✅-прикладами
- `npm/rules/js-bun-db/policy/package_json/template/package.json.deny.json`: `pg-format` (unscoped) та `mysql2` лишилися в denylist; `pg` прибрано окремим рішенням
- AST-сканер `npm/scripts/utils/bun-sql-scan.mjs`: детектує лише внутрішні `format`-шими — зовнішній `@scaleleap/pg-format` не флагується

---

## ADR Виключення `pg` для PostgreSQL LISTEN/NOTIFY

## Context and Problem Statement
Пакет `pg` був повністю заборонений правилом `js-bun-db`. Водночас Bun SQL станом на момент сесії не підтримує `LISTEN`/`NOTIFY`/`UNLISTEN` — єдиний механізм push-нотифікацій у PostgreSQL, який використовується у черзі нотифікацій проєкту.

## Considered Options
* Залишити `pg` у `package.json.deny.json`, дозволити лише вручну через коментар-виключення
* Прибрати `pg` з denylist, дозволити без обмежень
* Прибрати `pg` з denylist, але перевіряти AST: `pg` дозволений лише у файлах, де є LISTEN/NOTIFY-сигнал; на рівні repo — тільки якщо хоч один файл містить такий сигнал

## Decision Outcome
Chosen option: "AST-детектор: `pg` дозволений лише у файлах з LISTEN/NOTIFY", because звичайні SELECT/INSERT/UPDATE запити через `pg` залишаються забороненими — `pg` тільки для LISTEN/NOTIFY (підтверджено відповіддю користувача під час сесії).

### Consequences
* Good, because transcript фіксує очікувану користь: `pg` для нотифікацій легітимний, решта коду мігрує на Bun SQL; check дає точний fail-сигнал: «`import 'pg'` у файлі без LISTEN/NOTIFY».
* Bad, because AST-детектор покриває лише `<obj>.query('LISTEN…')`, `<obj>.on('notification', …)` та tagged literal `` `LISTEN…` `` — екзотичніші паттерни (динамічний рядок через змінну) не детектуються, що може дати false-negative.

## More Information
- `npm/scripts/utils/bun-sql-scan.mjs`: нові експорти `textHasPgLibImport`, `findPgLibImportInText`, `findPgListenNotifyUsageInText`
- `npm/rules/js-bun-db/fix/safety/check.mjs`: функція `checkPgDependencyAndUsage` — per-repo та per-file перевірки
- `npm/rules/js-bun-db/policy/package_json/template/package.json.deny.json`: `pg` прибрано з denylist
- `npm/rules/js-bun-db/policy/package_json/package_json_test.rego`: тести оновлено відповідно
- `npm/rules/js-bun-db/js-bun-db.mdc` v1.10: нова секція «`pg`: виключення для LISTEN/NOTIFY» з прикладом окремого файлу `pg-listen.ts`
- 5 нових тестів у `npm/rules/js-bun-db/fix/safety/check.test.mjs`

---

## ADR Заборона `sql.unsafe(template_literal_with_interpolation)` навіть з `allow-unsafe`

## Context and Problem Statement
Правило дозволяло `sql.unsafe(...)` з template literal та `${...}`-інтерполяцією за умови маркера `// allow-unsafe: <причина>`. Це створювало вразливий паттерн: DDL-запити типу `` sql.unsafe(`CREATE TABLE ${tableName}`) `` екранували identifier через JS-інтерполяцію, а не через `%I`, що небезпечно при неперевірених значеннях.

## Considered Options
* Залишити поточний підхід: `sql.unsafe` з template + `allow-unsafe` маркером дозволений
* Hard ban: будь-який `sql.unsafe(TemplateLiteral)` з `expressions.length > 0` заборонений навіть з маркером — конвертувати на `@scaleleap/pg-format format('%I', ...)` + `sql.unsafe(text, [bindParams])`

## Decision Outcome
Chosen option: "Hard ban `sql.unsafe(TemplateLiteral з expressions)` навіть з маркером", because маркер `allow-unsafe` не усуває ризик injection через JS template interpolation; identifier-escaping має відбуватись через `format('%I', ...)` (підтверджено відповіддю користувача під час сесії).

### Consequences
* Good, because transcript фіксує очікувану користь: identifiers гарантовано проходять через `pg-format`-escape, а не через сирий JS template string; детектор AST-рівня (`expressions.length > 0` у `TemplateLiteral`) не обходиться маркером.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `npm/scripts/utils/bun-sql-scan.mjs`: новий експорт `findBunSqlUnsafeWithInterpolatedTemplateInText` — флагує `<obj>.unsafe(TemplateLiteral)` де `expressions.length > 0`, маркер `// allow-unsafe` не знімає fail
- `npm/rules/js-bun-db/fix/safety/check.mjs`: hard fail з порадою переписати через `format('%I', ...)` + `sql.unsafe(text, [params])`
- `npm/rules/js-bun-db/js-bun-db.mdc` v1.11: підсекція «`sql.unsafe` з template-літералом і `${...}`-інтерполяцією — заборонено навіть з маркером»; основний DDL-приклад переписано на безпечний варіант
- `npm/rules/js-bun-db/fix/safety/check.test.mjs`: попередній DDL-тест переписано, додано 2 нових тести
