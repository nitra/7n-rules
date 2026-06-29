---
type: JS Module
title: fix-vscode_extensions.mjs
resource: npm/rules/rego/vscode_extensions/fix-vscode_extensions.mjs
docgen:
  crc: 3353fe17
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.98
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл ініціює процес корекції, викликаючи зовнішній скрипт для виконання визначеного набору шаблонів. Він служить точкою старту для механізму, який застосовує відповідні шаблони для корекції конфігурацій або структури.

## Поведінка

1. Ініціалізує процес корекції, викликаючи визначений набір шаблонів з файлу `../../../scripts/lib/fix/vscode-ext-add.mjs`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
