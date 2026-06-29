---
type: JS Module
title: fix-vscode_extensions.mjs
resource: npm/rules/rust/vscode_extensions/fix-vscode_extensions.mjs
docgen:
  crc: 3353fe17
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Надайте мені чорнетку секції "overview", яку потрібно переписати, щоб я міг застосувати ваші інструкції.

## Поведінка

1. Ініціалізує логіку для виправлення VS Code Extensions.
2. Імпортує шаблони логіки для додавання до VS Code Extensions з файлу `../../../scripts/lib/fix/vscode-ext-add.mjs`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
