---
type: JS Module
title: main.mjs
resource: npm/rules/ga/vscode_extensions/main.mjs
docgen:
  crc: c80b29e6
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.96
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Огляд
Модуль перевіряє відповідність конфігурації, визначеної у `.vscode/extensions.json`, заданим політичним правилам, використовуючи логіку Rego.

Поведінка
Викликає функцію `lint` для підтвердження відповідності конфігурації розширення. Спирається на конфігурації, описані в `extensions.json`.

## Поведінка

1. Викликає функцію lint для перевірки відповідності конфігурації розширення.
2. Перевіряє наявність файлу `.vscode/extensions.json`, який визначає конфігурацію розширення.
3. У випадку відсутності `.vscode/extensions.json` повідомляє про необхідність додавання `github.vscode-github-actions` (ga.mdc).
4. Використовує правила Rego для оцінки політики.

## Публічний API

lint — Визначає, чи відповідає конфігурація у `extensions.json` вимогам політики, визначеної у `ga.mdc`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
