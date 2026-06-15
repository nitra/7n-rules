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

## Update 2026-06-05

**Виправлення прямого `process.env` у тестах**: У `npm/rules/changelog/js/tests/consistency/tests/check.test.mjs:887` виявлено `process.env.N_CURSOR_CHANGELOG_AUTOFIX`. Замінено на `import { env } from 'node:process'` (опційна змінна — правило `n-js-run.mdc` допускає цей шлях для опційних змінних). Після виправлення: `fix js-run` → `✨ 1/1 правил без зауважень`.

**Супутнє виправлення**: Відсутній крок `name: "Release (bump + CHANGELOG + tag)"` у job `release-publish` `.github/workflows/npm-publish.yml` виявлено через `❌ npm_publish_yml: ...` та відновлено відповідно до `n-npm-module.mdc`. Форматування після змін: `bunx oxfmt .`
