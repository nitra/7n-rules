---
type: JS Module
title: vitest.config.mjs
resource: plugins/lang-python/vitest.config.mjs
docgen:
  crc: ce60c570
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Vitest-конфіг плагіна lang-python: env-канон ядра + include лише тестів плагіна.

## Поведінка

Налаштування Vitest для плагіна `lang-python` забезпечує використання канонічної конфігурації ядра середовища. Файл включає лише тести, специфічні для цього плагіна.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
