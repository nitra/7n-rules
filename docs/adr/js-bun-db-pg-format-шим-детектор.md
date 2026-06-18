---
type: ADR
title: "js-bun-db: заборона pg-format-шимів — AST-детектори v1.6"
---

# js-bun-db: заборона pg-format-шимів — AST-детектори v1.6

**Status:** Accepted
**Date:** 2026-05-08

## Контекст

При міграції з `pg-format` на Bun SQL у кодових базах виникав антипатерн — збереження `pg-format`-сумісного API під новим іменем (`format()`, `pgRead.query(text, params)`) з внутрішнім викликом `sql.unsafe(...)`. Такий шим зберігав injection-поверхню, від якої мала відбутись міграція, просто ховаючи її за «зручним» іменем.

## Рішення/Процедура/Факт

У правило `js-bun-db.mdc` (v1.5 → v1.6) додано розділ «pg-format: повне видалення, без шимів» з таблицею ідіом міграції та прикладами забороненого коду. У `bun-sql-scan.mjs` реалізовано два нові AST-детектори:

- `findPgFormatShimDefinitionInText` — виявляє функції з іменами `format`/`pgFormat`/`sqlFormat`/`pgFmt`, у тілі яких є `%L`/`%I`/`%s`, а також будь-які `quoteLiteral`/`quoteIdent`/`escapeLiteral`/`escapeIdent`.
- `findPgFormatLikeQueryWrapperInText` — виявляє обʼєктний метод `query(text, params)` з `*.unsafe(...)` у тілі.

Обидва детектори спрацьовують лише у файлах з `import { sql } from 'bun'` або `import { SQL } from 'bun'`. Оркестратор `check-js-bun-db.mjs` підключено до обох детекторів з відповідними повідомленнями `fail` і `pass`. Версія пакету `1.8.209` → `1.8.210`.

## Обґрунтування

Шим `format()` → `sql.unsafe(format(...))` є логічно еквівалентним прямому `sql.unsafe` з конкатенацією рядків — injection-вектор не усунено. Явний AST-детектор у `check-js-bun-db` дозволяє автоматично виявляти такий технічний борг на CI, а не покладатись на code-review. Детектор навмисно прив'язаний до наявності `import sql from 'bun'`, щоб не генерувати хибнопозитивні спрацьовування для форматерів дат чи URL у не-SQL коді.

## Розглянуті альтернативи

Не обговорювалися; підхід (AST-детектор у межах існуючого `check-js-bun-db`) був заданий у патчі.

## Зачіпає

`npm/mdc/js-bun-db.mdc`, `npm/scripts/utils/bun-sql-scan.mjs` (нові експорти `findPgFormatShimDefinitionInText`, `findPgFormatLikeQueryWrapperInText`), `npm/scripts/check-js-bun-db.mjs`, `npm/package.json`, `npm/CHANGELOG.md`.
