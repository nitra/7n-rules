---
type: JS Module
title: vitest.config.mjs
resource: plugins/lang-rust/vitest.config.mjs
docgen:
  crc: e5f460bd
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Vitest-конфіг плагіна lang-rust: env-канон ядра + include лише тестів плагіна.

## Поведінка

Визначає канонічну конфігурацію Vitest для плагіна `lang-rust`, використовуючи спільний механізм конфігурації. Включає лише тести самого плагіна у тестовий простір.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
