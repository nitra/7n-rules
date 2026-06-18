---
type: JS Module
title: list-project-rules-mdc.mjs
resource: npm/scripts/lib/list-project-rules-mdc.mjs
docgen:
  crc: e17e0855
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
---

Експортує константу CURSOR_RULES_DIR, яка вказує на каталог правил у проєкті-споживачі. Надає функцію для отримання відсортованого списку всіх файлів правил `.mdc` з цього каталогу.

## Поведінка

CURSOR_RULES_DIR — Вказує на каталог правил у проєкті-споживачі.
listProjectRulesMdcFiles — Повертає відсортований список імен файлів з розширенням `.mdc` у каталозі правил проєкту, або порожній масив, якщо каталог не існує.

## Публічний API

CURSOR_RULES_DIR — Шлях до каталогу правил у проєкті-споживачі.
listProjectRulesMdcFiles — Збирає список файлів MDC, що містять правила проєкту.

## Гарантії поведінки

- Read-only: файл не виконує операцій запису у файлову систему.
- Не звертається до мережі.
