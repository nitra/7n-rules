---
type: JS Module
title: fix-marksman_config.mjs
resource: npm/rules/ci4/marksman_config/fix-marksman_config.mjs
docgen:
  crc: 39e3c9a4
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.99
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Файл забезпечує наявність конфігурації Marksman у робочому середовищі, автоматично копіюючи канонічний базовий файл `.marksman.toml` без використання LLM, якщо конфігурація відсутня. Функція `patterns` надає набір правил для подальшого автоматичного виправлення (ci4.mdc).

## Поведінка

1. Визначається набір правил `patterns` для автоматичного виправлення конфігурації Marksman.
2. Перевіряється, чи відсутня конфігурація Marksman.
3. Якщо конфігурація відсутня, створюється файл конфігурації Marksman за допомогою копіювання канонічного базового файлу `ci4.mdc` у робочу директорію.
4. Фіксується, що файл конфігурації був створений із канонічного базового файлу `ci4.mdc`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
