# Ланцюжок запуску правила `abie` через `/n-fix`

**Status:** Accepted
**Date:** 2026-05-15

## Контекст

Непрозорий шлях від виклику `/n-fix` з одним активованим правилом `abie` до фактичного виконання JS-скрипта й Rego-перевірок. Потребує документування для орієнтації нових учасників і усунення збоїв.

## Рішення/Процедура/Факт

Повний ланцюжок виконання:

1. `/n-fix` читає `.cursor/skills/n-fix/SKILL.md` та запускає `npx @nitra/cursor check`.
2. `npm/bin/n-cursor.js` — точка входу CLI; при аргументі `check` зчитує `.n-cursor.json` проєкту, бере масив `rules` і для кожного правила, де знайдено `rules/{rule}/js/check.mjs`, запускає відповідний скрипт.
3. `npm/rules/abie/js/check.mjs` — перевіряє наявність `"abie"` у масиві `rules` файлу `.n-cursor.json` (інакше завершується з кодом 0, щоб не конфліктувати з `ga.mdc`), знаходить K8s-файли і передає їх у `run-conftest-batch.mjs`.
4. `npm/scripts/utils/run-conftest-batch.mjs` — викликає `conftest test` батчами, вказує шлях до Rego-полісей (`npm/rules/abie/policy/<name>/`), повертає структуровані порушення назад у `check.mjs`.
5. Rego-полісі (`health_check_policy.rego`, `http_route_base.rego` тощо) — авторитетна логіка перевірки; JS-шар лише оркеструє `conftest` і форматує вивід.

## Обґрунтування

Розділення «що перевіряти» (JS — вибір файлів, умови активації) від «як перевіряти» (Rego — структурна логіка) дозволяє тестувати полісі незалежно через `conftest test` локально і тримати `check.mjs` тонким оркестратором без власної бізнес-логіки.

## Розглянуті альтернативи

Не обговорювалися.

## Зачіпає

`.cursor/skills/n-fix/SKILL.md`, `npm/bin/n-cursor.js`, `npm/rules/abie/js/check.mjs`, `npm/scripts/utils/run-conftest-batch.mjs`, `npm/rules/abie/policy/`.
