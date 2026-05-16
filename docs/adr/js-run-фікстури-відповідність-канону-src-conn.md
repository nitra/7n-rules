# Виправлення фікстур тестів `check-js-run` — відповідність канону `src/conn/`

**Status:** Accepted
**Date:** 2026-05-16

## Контекст

Два тести у `npm/rules/js-run/fix/runtime/check-fixture.test.mjs` падали через невідповідність фікстур канону правила `js-run`. Фікстури використовували `pg.js` з `export const db` та шлях `lib/connections/pg.js`, що суперечило вимогам: файли у `src/conn/` мають називатися `pg-read.js` або `pg-write.js` і мати іменований експорт у camelCase від basename.

## Рішення/Процедура/Факт

Фікстури перейменовано на `pg-write.js` з `export const pgWrite` у `src/conn/`, а також `pg-write.js` у `lib/connections/`. Правило `check.mjs` залишилося без змін — логіка перевірки була правильною, фікстури відставали від канону. Версію бампнуто з `1.11.16` на `1.11.17`.

## Обґрунтування

Канон `js-run` вимагає, щоб файли у `src/conn/` дотримувались схеми іменування `ql-<id>` / `(pg|mysql|mssql)-(read|write)[-<id>]` і мали іменований експорт у camelCase від basename. Фікстури не було оновлено після ускладнення канону.

## Розглянуті альтернативи

Не обговорювалися.

## Зачіпає

`npm/rules/js-run/fix/runtime/check-fixture.test.mjs`
