---
type: JS Module
title: cli-entry-as-cli.mjs
resource: npm/scripts/tests/fixtures/cli-entry-as-cli.mjs
docgen:
  crc: b8c5b5eb
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.95
  retried: true
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Визначає, чи виконується цей файл як точка входу для командного інтерфейсу (CLI), порівнюючи його з `process.argv[1]`. Виводить `TRUE` або `FALSE` на стандартний вивід, що використовується тестом `cli-entry.test.mjs` для підтвердження, що файл був ініційований як CLI entry.

## Поведінка

1. Перевіряє, чи виконується цей файл як основний вхідний модуль CLI.
2. На основі результату перевірки виводить на стандартний вивід `TRUE` або `FALSE`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
