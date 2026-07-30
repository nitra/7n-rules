---
type: JS Module
title: vitest.config.shared.mjs
resource: plugins/vitest.config.shared.mjs
docgen:
  crc: 153c2efe
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Створює спільний Vitest config для language plugins у monorepo.

Кожен plugin запускає лише власні test surfaces, використовує isolated
process pool і пише LLM trace у системну temporary directory.

## Поведінка

Повернення об'єкта конфігурації Vitest забезпечує стандартизовані параметри для тестового середовища, включаючи визначені глоби для пошуку тестів по різних плагінах та виключення папки з залежностями.

Виклик функції createPluginVitestConfig повертає повну конфігурацію Vitest, що налаштовує ізольований пул процесів для забезпечення незалежності тестів.

У разі помилки конфігурації, вихід буде визначений стандартним механізмом Vitest.

Встановлене середовище виконання 'node' та фіксований час тайм-ауту 20000 мс забезпечують стабільність тестів.

## Публічний API

- createPluginVitestConfig — Повертає canonical plugin Vitest config без package-specific drift.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Свідомо пропускає шляхи: `node_modules`.
