---
type: JS Module
title: main.mjs
resource: npm/rules/rego/check/main.mjs
docgen:
  crc: a3a71143
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл забезпечує механізм для перевірки якості коду на мові Rego. Він виконує серію дій: запуск `opa check`, `regal lint` та `conftest verify` для валідації Rego-файлів. Ці дії допомагають підтримувати коректність логіки правил, що описують систему. Для встановлення `conftest` зверніться до https://www.conftest.dev/install/.

## Поведінка

Поведінка
runLintRegoSteps виконує послідовні перевірки коду Rego за допомогою інструментів opa, regal та conftest.
runLintRego виконує стандартизований запуск лінтера для файлів Rego.
lint виконує запуск лінтера для файлів Rego. Для встановлення conftest, що використовується для перевірки юніт-тестів Rego, зверніться до https://www.conftest.dev/install/.

## Публічний API

runLintRegoSteps — виконує послідовність перевірок Rego-правил.
runLintRego — запускає повну перевірку на основі Rego-правил.
lint — здійснює перевірку поверхні Rego.

Для встановлення залежностей, зокрема звідки походять правила, зверніться до: https://www.conftest.dev/install/

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
