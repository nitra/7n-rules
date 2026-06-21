---
type: JS Module
title: lint.mjs
resource: npm/rules/ga/js/lint.mjs
docgen:
  crc: 9967abd6
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 90
---

## Огляд

Цей файл надає CLI-обгортку (`runLintGaCli`), яка використовується як підкоманда `lint-ga` з `bin/n-cursor.js` для виконання перевірки правил, визначених у (ga.mdc). Обгортка автоматично встановлює `shellcheck` та `conftest` за допомогою `ensureTool` (використовуючи `brew`/`scoop`/GitHub Release залежно від платформи). Потім вона перевіряє наявність `uv` (необхідного для `uvx zizmor`). Якщо `uv` відсутній, надається підказка з командою встановлення, наприклад, https://astral.sh/uv/install.sh. Далі послідовно виконуються `bunx github-actionlint`, `uvx zizmor --offline --collect=workflows .`, а результати делегуються до `rules/ga/check.mjs::check`, де виконуються перевірки Rego-полісі та JS cross-file правил.

## Поведінка

runLintGaCli виконує канонічний процес перевірки правил `ga.mdc`, автоматично встановлюючи `shellcheck` та `conftest`, перевіряючи наявність `uv`, а потім послідовно запускаючи `github-actionlint`, `zizmor` та перевірку Rego-полісі.
lint делегує виконання канонічного процесу перевірки правил `ga.mdc` через `runLintGaCli`.

## Публічний API

runLintGaCli — запускає інструменти для аналізу коду.
lint — керує запуском інструментів аналізу коду, викликаючи `runLintGaCli`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
