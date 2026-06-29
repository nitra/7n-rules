---
type: JS Module
title: concern-meta.mjs
resource: npm/scripts/lib/concern-meta.mjs
docgen:
  crc: da6ece6c
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  issues: judge:inaccurate:0.97
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Цей модуль зчитує та валідує схему конфігурації, визначену у `concern.json`. Він надає функції для отримання метаданих concern-ів та списку доступних concern-ів. Модуль працює в режимі fail-safe: при виявленні помилок він не генерує винятків, а повертає `null` замість них.

## Поведінка

Поведінка
readConcernMeta зчитує і перевіряє файл concern.json у вказаній директорії concern-а, повертаючи метадані або null, якщо файл відсутній чи не валідний.
listConcerns сканує директорію правил і повертає список усіх знайдених concern-ів у алфавітному порядку, ігноруючи каталоги без concern.json.

## Публічний API

readConcernMeta — Зчитує та уніфікує налаштування з `concern.json` у каталозі; повертає відсутність або недійсність.
listConcerns — Повертає список усіх визначених concern-ів з підкаталогів `ruleDir` у алфавітному порядку, ігноруючи каталоги без `concern.json`.

## Гарантії поведінки

- Read-only: не виконує операцій запису (ФС/БД).
- Перехоплює помилки і не пропускає винятків назовні (fail-safe).
- За певних помилок повертає порожнє значення (напр. `null`) замість винятку.
