---
type: JS Module
title: vitest.config.mjs
resource: plugins/lang-js/vitest.config.mjs
docgen:
  crc: ec10afc7
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Vitest-конфіг плагіна lang-js: env-канон ядра + include лише тестів плагіна.

## Поведінка

Конфігурація забезпечує, що запуски тестів для цього плагіна використовують встановлене канонічне середовище ядро. Тестування обмежується лише кодом, що належить до самого плагіна.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
