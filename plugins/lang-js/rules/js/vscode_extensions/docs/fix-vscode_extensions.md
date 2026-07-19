---
type: JS Module
title: fix-vscode_extensions.mjs
resource: plugins/lang-js/rules/js/vscode_extensions/fix-vscode_extensions.mjs
docgen:
  crc: b6cffd44
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл визначає шаблони, які використовуються для корекції компонентів VS Code. Він застосовує ці шаблони для забезпечення відповідності коду вимогам, визначеним у конфігураціях, а також для корекції помилок, описаних в [ANKOR_ISSUE_1] та [ANKOR_ISSUE_2].

## Поведінка

1. Ідентифікує шаблони, необхідні для корекції розширень VS Code.
2. Застосовує ці шаблони для приведення коду до відповідності стандартам.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
