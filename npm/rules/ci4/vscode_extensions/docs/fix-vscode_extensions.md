---
type: JS Module
title: fix-vscode_extensions.mjs
resource: npm/rules/ci4/vscode_extensions/fix-vscode_extensions.mjs
docgen:
  crc: 3353fe17
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: best-of-2:retry-won,judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл відповідає за ініціалізацію процесу корекції розширень VS Code. Він виконує корекцію, використовуючи визначені у `../../../scripts/lib/fix/vscode-ext-add.mjs` шаблони.

## Поведінка

1. Ініціалізує логіку для корекції VS Code розширень.
2. Використовує шаблони, визначені у `../../../scripts/lib/fix/vscode-ext-add.mjs`, для виконання корекції.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
