---
type: JS Module
title: fix-vscode_extensions.mjs
resource: npm/rules/style/vscode_extensions/fix-vscode_extensions.mjs
docgen:
  crc: 3353fe17
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл ініціює процес інтеграції визначених шаблонів у розширення VS Code шляхом запуску зовнішнього скрипта. Цей скрипт забезпечує впровадження архітектурних патернів у ці розширення.

## Поведінка

1. Ініціює процес застосування визначених шаблонів до розширень VS Code.
2. Використовує зовнішній скрипт для додавання необхідних патернів до розширень.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
