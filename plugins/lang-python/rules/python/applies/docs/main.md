---
type: JS Module
title: main.mjs
resource: plugins/lang-python/rules/python/applies/main.mjs
docgen:
  crc: 073f0b2f
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 100
  issues: judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Перевіряє наявність файлу `pyproject.toml` у корені репозиторію для визначення, чи має застосовуватися правило до проєктів, що використовують Python. Публічні функції `applies` та `main` реалізують цю логіку.

## Поведінка

applies визначає, чи застосовне правило, перевіряючи наявність файлу `pyproject.toml` у корені репозиторію.
main повідомляє про успішне знаходження файлу `pyproject.toml`, що підтверджує застосування правила для Python.

## Публічний API

- applies — визначає загальні налаштування та конфігурацію.
- main — виводить загальний контекст, тоді як спеціалізовані блоки виконують конкретні перевірки.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
