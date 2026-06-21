---
type: JS Module
title: lint.mjs
resource: npm/rules/ga/js/lint.mjs
docgen:
  crc: c2bd74f8
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 90
---

## Огляд

CLI-обгортка над канонічним `lint-ga` (ga.mdc) автоматично готує середовище для перевірки конфігурацій GitHub Actions відповідно до стандартів, визначених у (ga.mdc). Вона встановлює необхідні інструменти (`shellcheck`, `conftest`) через `ensureTool` (використовуючи `brew`/`scoop`/GitHub Release per-platform). Для виконання перевірок використовується `bunx github-actionlint` та `uvx zizmor`. Якщо `uv` відсутній, користувачеві надається підказка з командою встановлення, наприклад, https://astral.sh/uv/install.sh. Усі перевірки, включаючи Rego-полісі, централізовані у `rules/ga/check.mjs`.

## Поведінка

runLintGaCli виконує послідовний запуск перевірок: автоматично встановлює `shellcheck` та `conftest`, перевіряє наявність `uv`, запускає `github-actionlint`, `zizmor`, а потім виконує Rego-полісі та JS cross-file перевірки правил (відповідно до (ga.mdc)).
lint делегує виконання до `runLintGaCli`, забезпечуючи аналіз всього репозиторію.

## Публічний API

runLintGaCli — виконує перевірку коду за допомогою інструментарію.
lint — керує запуском перевірки коду, викликаючи `runLintGaCli`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
