---
type: JS Module
title: fix-emit_types_config.mjs
resource: plugins/lang-js/rules/npm-module/emit_types_config/fix-emit_types_config.mjs
docgen:
  crc: 794ac7f5
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

По-перше, цей файл відповідає за формування файлу `npm/tsconfig.emit-types.json`. Він використовує шаблон для створення відсутнього конфігураційного файлу або доповнює існуючий, додаючи лише канонічні поля, визначені у шаблоні правила. При цьому локальні налаштування, присутні у вихідному файлі, залишаються незмінними.

## Поведінка

1. Визначає шаблон для конфігурації генерації типів у файлі tsconfig.emit-types.json.
2. Створює масив patterns, який містить шаблон для автоматичного заповнення або доповнення файлу tsconfig.emit-types.json канонічними полями.
3. Забезпечує, що локально налаштовані параметри в цій конфігурації не будуть перезаписані.

## Публічний API

- patterns — Фікс-патерни концерну: один template-deep-merge запис для `npm/tsconfig.emit-types.json`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
