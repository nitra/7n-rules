---
type: JS Module
title: fix-vscode_extensions.mjs
resource: npm/rules/style/policy/vscode_extensions/fix-vscode_extensions.mjs
docgen:
  crc: 319883fc
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

## Огляд

Завантажує шаблони для виправлення розширень VS Code.

## Поведінка

1. Імпортує шаблони для виправлення розширень VS Code з файлу `../../../../scripts/lib/fix/vscode-ext-add.mjs`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
