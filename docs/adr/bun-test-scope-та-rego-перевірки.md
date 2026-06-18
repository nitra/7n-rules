---
type: ADR
title: "bun test не запускає Rego-перевірки"
---

# bun test не запускає Rego-перевірки

**Status:** Accepted
**Date:** 2026-05-13

## Контекст

У репозиторії `n-cursor` є два окремих набори перевірок: JavaScript-тести (`*.test.mjs`) та Rego-правила (`*_test.rego`). Виникло питання, чи виконує `bun test` також перевірки Rego-правил.

## Рішення/Процедура/Факт

`bun test` запускає лише `.test.mjs`-файли у `npm/tests/` — жодного Rego-раннера серед них немає. Rego-тести (`*_test.rego`-фікстури) виконуються окремо командою `bun run lint-rego`, яка викликає `conftest verify`. Скрипт `lint-rego.mjs` знаходиться у `npm/scripts/`, а не у `npm/tests/`.

## Обґрунтування

Коментар у `npm/tests/check-abie.test.mjs` явно фіксує цю межу: «Покриття цих правил тепер забезпечують `_test.rego` фікстури, що виконуються через `bun run lint-rego` (`conftest verify`)». Rego-перевірки свідомо винесені за межі `bun test`.

## Розглянуті альтернативи

Не обговорювалися.

## Зачіпає

`package.json` (script `test`), `npm/tests/` (Bun-тести), `npm/scripts/lint-rego.mjs`, `conftest verify`.
