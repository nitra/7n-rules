---
type: JS Module
title: fix-vscode_extensions.mjs
resource: npm/rules/tauri/vscode_extensions/fix-vscode_extensions.mjs
docgen:
  crc: 3353fe17
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Цей файл зчитує визначені конфігураційні шаблони з файлу конфігурації, що використовується розширеннями VS Code. Це дозволяє забезпечити послідовне впровадження нових функцій та компонентів у розширення.

## Поведінка

1. Витягує визначені шаблони з файлу `../../../scripts/lib/fix/vscode-ext-add.mjs`.
2. Повертає ці шаблони.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
