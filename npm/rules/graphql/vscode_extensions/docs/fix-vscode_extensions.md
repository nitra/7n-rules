---
type: JS Module
title: fix-vscode_extensions.mjs
resource: npm/rules/graphql/vscode_extensions/fix-vscode_extensions.mjs
docgen:
  crc: 3353fe17
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
  issues: short-behavior,judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Використовується для генерації шаблонів, які забезпечують уніфіковану структуру для корекції інцидентів у розширеннях VS Code. Це гарантує послідовність підходу до обробки помилок, що підвищує передбачуваність процесу виправлення.

## Поведінка

1. Додає шаблони для виправлення VS Code Extensions.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
