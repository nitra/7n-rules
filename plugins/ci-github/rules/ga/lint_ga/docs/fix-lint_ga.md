---
type: JS Module
title: fix-lint_ga.mjs
resource: plugins/ci-github/rules/ga/lint_ga/fix-lint_ga.mjs
docgen:
  crc: b0207391
  model: openai-codex/gpt-5.5
  tier: cloud-avg
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл підтримує T0-фікс для концерну `lint_ga`: приводить CI-workflow лінту `ga`-домену в консюмер-репо до канонічного шаблону концерну.

Публічна функція `patterns` визначає застосування цього виправлення.

## Поведінка

1. `patterns` визначає єдиний канонічний T0-fix для workflow лінту `ga`-домену в консюмер-репо.

2. `patterns` описує приведення `.github/workflows/lint-ga.yml` до шаблону концерну.

3. Якщо цільового workflow ще немає, `patterns` описує його створення з канонічного шаблону.

4. `patterns` не виконує власних операцій запису у файл самостійно, а лише експортує правило виправлення для зовнішнього механізму.

5. Під час роботи концерну обробляється цільовий workflow `.github/workflows/lint-ga.yml`.

## Публічний API

- patterns — Один детермінований патерн для канонічного snippet-а концерну в
`.github/workflows/lint-ga.yml` консюмер-репо.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
