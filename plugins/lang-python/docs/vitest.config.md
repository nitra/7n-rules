---
type: JS Module
title: vitest.config.mjs
resource: plugins/lang-python/vitest.config.mjs
docgen:
  crc: 7bbc9f47
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Vitest-конфіг плагіна lang-python: env-канон ядра + include лише тестів плагіна.

## Поведінка

Для запуску тестів вимагається наявність середовища `node`. Визначені змінні середовища `GIT_TRACE2_EVENT` та `N_LLM_TRACE_PATH` використовуються для керування трасуванням під час виконання тестів. Тестовий процес має обмеження часу в 20000 мілісекунд. Тести виконуються у режимі `forks` для ізоляції. Перевіряється лише підмножина тестів, визначена у списку `include`, ігноруючи будь-які файли в каталозі `node_modules`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Свідомо пропускає шляхи: `node_modules`.
