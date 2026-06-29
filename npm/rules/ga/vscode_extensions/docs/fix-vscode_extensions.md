---
type: JS Module
title: fix-vscode_extensions.mjs
resource: npm/rules/ga/vscode_extensions/fix-vscode_extensions.mjs
docgen:
  crc: 3353fe17
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл сканує код розширення VS Code на наявність типових помилок. Він застосовує виправлення до знайдених зразків відповідно до визначеної логіки.

## Поведінка

1. Виявляє зразки, що потребують виправлення у розширень VS Code.
2. Застосовує виправлення, використовуючи логіку, визначену в скрипті `../../../scripts/lib/fix/vscode-ext-add.mjs`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
