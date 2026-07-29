---
type: JS Module
title: vitest.config.mjs
resource: plugins/lang-rust/vitest.config.mjs
docgen:
  crc: f704386f
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Vitest-конфіг плагіна lang-rust: env-канон ядра + include лише тестів плагіна.

## Поведінка

Цей конфігураційний файл визначає середовище для виконання тестів плагіна `lang-rust` за допомогою Vitest. Він гарантує встановлення специфічних змінних середовища, таких як `GIT_TRACE2_EVENT=0` та шлях для логування трасування LLM у тимчасовому каталозі. Тестування виконується у режимі `node`, а виконання скупчення (pool) відбувається через `forks`, що ізолює процеси тестів. Шляхи до тестів чітко обмежені тестами, що належать компонентам самого плагіна (`taze`, `rules`, `doc-files`, `knowledge`, `coverage-provider`, `slots`), і свідомо виключаються всі пакети з `node_modules`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Свідомо пропускає шляхи: `node_modules`.
