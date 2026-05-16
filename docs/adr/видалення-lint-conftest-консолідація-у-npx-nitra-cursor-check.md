# Видалення lint-conftest та консолідація у npx @nitra/cursor check

**Status:** Accepted
**Date:** 2026-05-16

## Контекст

У npm-пакеті `@nitra/cursor` існував окремий CLI-subcommand `lint-conftest` і відповідний скрипт `npm/scripts/lint-conftest.mjs`, що виконував rego-перевірки через `conftest`. Після реструктуризації до `fix/lint/policy`-директорій та консолідації всіх перевірок у `npx @nitra/cursor check` цей канал став дублікатом без додаткової функціональної цінності.

## Рішення/Процедура/Факт

Видалено `npm/scripts/lint-conftest.mjs`; прибрано скрипт `lint-conftest` та його ланку з кореневого `package.json` (lint-chain); оновлено `conftest.mdc` — крок 5 (реєстрація policy) переписано: `discoverCheckableRules` автоматично підхоплює rego через `target.json`; прибрано згадки `lint-conftest.mjs` із `scripts.mdc`, `abie.mdc`, 10 check.mjs і 7 rego-файлів. Версія пакету піднята з `1.11.10` до `1.11.11`.

## Обґрунтування

`npx @nitra/cursor check` вже охоплює всі policy-concerns через `discoverCheckableRules` + `target.json`-autodiscovery. Окремий `lint-conftest` канал є зайвою точкою підтримки без жодних переваг порівняно з єдиним consolidated-ентрипоінтом.

## Розглянуті альтернативи

Альтернативи не розглядалися — консолідація у `npx @nitra/cursor check` є єдиним логічним кроком після завершення fix/lint/policy-реструктуризації.

## Зачіпає

`npm/scripts/lint-conftest.mjs` (видалено), `package.json#scripts`, `conftest.mdc`, `scripts.mdc`, `abie.mdc`, `npm/rules/*/fix/**/check.mjs` (10 файлів), `npm/rules/*/policy/**/*.rego` (7 файлів).
