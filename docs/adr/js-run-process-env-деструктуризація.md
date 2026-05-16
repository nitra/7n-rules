# Заміна process.env.* на env з node:process у bin/n-cursor.js

**Status:** Accepted
**Date:** 2026-05-07

## Контекст

Правило `js-run.mdc` забороняє прямий доступ `process.env.*` у CLI-скриптах — усі змінні середовища мають отримуватися через деструктуроване `env` з `node:process` (опційні) або через `@nitra/check-env` (обов'язкові). Інтеграційний тест `integration-repo-checks.test.mjs` виявив порушення у `bin/n-cursor.js`: два місця звернення до `process.env.NITRA_CURSOR_REEXEC`.

## Рішення/Процедура/Факт

- `npm/bin/n-cursor.js:56` — імпорт `import { cwd } from 'node:process'` розширено до `import { cwd, env } from 'node:process'`.
- Два місця використання `process.env.NITRA_CURSOR_REEXEC` замінено на `env.NITRA_CURSOR_REEXEC` — у перевірці re-exec guard та передачі в `spawnSync`.

## Обґрунтування

`NITRA_CURSOR_REEXEC` — внутрішня опційна змінна самого CLI (ознака повторного запуску після self-upgrade); вона не є обов'язковою для запуску, тому достатньо `node:process` без `@nitra/check-env`. Зміна усунула єдине падіння в інтеграційних тестах (674 pass → 675 pass).

## Розглянуті альтернативи

`// @nitra/cursor ignore-next-line` — відхилено; проблема усувається правильним імпортом, а не придушенням перевірки.

## Зачіпає

`npm/bin/n-cursor.js` (рядки 56, ~1136, ~1160)
