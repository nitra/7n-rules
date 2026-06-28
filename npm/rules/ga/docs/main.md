---
type: JS Module
title: main.mjs
resource: npm/rules/ga/main.mjs
docgen:
  crc: 5685a807
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 90
---

Цей модуль є CLI-обгорткою над канонічним `lint-ga` (ga.mdc). Він автоматично встановлює `shellcheck` та `conftest` через `ensureTool` (використовуючи brew/scoop/GitHub Release залежно від платформи), перевіряє наявність `uv` (для `uvx zizmor`), а потім послідовно виконує `bunx github-actionlint`, `uvx zizmor --offline --collect=workflows .` та делегує до `rules/ga/check.mjs::check`. Функція `lint` викликає `runLintGaCli`, який є частиною оркестраторного адаптера `n-cursor lint ga`. При відсутності `uv`, користувачеві надається підказка з командою встановлення, наприклад, https://astral.sh/uv/install.sh, оскільки `uv` не в реєстрі `ensureTool`.

## Поведінка

run виконує стандартну перевірку правила, застосовуючи логіку, описану в `mdc-refs`.
runLintGaCli виконує повний канонічний процес `lint-ga`: автоматично встановлює `shellcheck` та `conftest`, перевіряє наявність `uv`, а потім послідовно запускає `github-actionlint`, `zizmor` та перевірку Rego-полісі через `rules/ga/check.mjs`.
lint делегує виконання повного канонічного процесу `lint-ga` через `runLintGaCli`.

## Публічний API

run — виконує основну перевірку, яка охоплює логіку застосування до JS-задач, політики та посилання на mdc-референси.
runLintGaCli — виконує лінтинг з використанням інструментів actionlint/zizmor та перевірку ga.
lint — керує процесом лінтингу, делегуючи виконання `runLintGaCli`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
