---
type: JS Module
title: vitest.config.mjs
resource: plugins/lang-php/vitest.config.mjs
docgen:
  crc: a1ee99ba
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Vitest-конфіг плагіна lang-php: env-канон ядра + include лише тестів плагіна.

## Поведінка

Конфігурація встановлює стандартні налаштування для Vitest, що відповідають екосистемним конвенціям ядра.
Вона включає лише тести, специфічні для плагіна `lang-php`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
