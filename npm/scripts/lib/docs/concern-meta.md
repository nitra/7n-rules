---
type: JS Module
title: concern-meta.mjs
resource: npm/scripts/lib/concern-meta.mjs
docgen:
  crc: 877433c9
  model: omlx/gemma-4-26b-a4b-it
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Парсер і нормалізатор `concern.json`. Єдине місце де читається і валідується схема concern-а.

## Поведінка

`readConcernMeta` повертає нормалізовані дані з `concern.json` або `null`, якщо файл відсутній, не є об'єктом або не відповідає мінімальним вимогам до структури (наприклад, через невалідний scope лінту). Якщо конфіг не містить жодної активної поверхні (lint, policy або check), він вважається невалідним.

`listConcerns` повертає відсортований за алфавітом масив об'єктів, що відповідають вимогам `concern.json`. Підкаталоги, які не містять валідного конфігу, ігноруються та не потрапляють у результат.

## Публічний API

- readConcernMeta — Читає і нормалізує `concern.json` з каталогу.
Повертає `null` якщо файл відсутній або не валідний.
- listConcerns — Сканує підкаталоги `ruleDir` і повертає всі concern-и (у алфавітному порядку).
Каталоги без `concern.json` ігноруються.

## Сценарії використання

- `npm/scripts/lib/tests/concern-meta.test.mjs` (concern-meta — policy.engine derivation; concern-meta — lint surface) — явний engine:; legacy check:; legacy без engine/check (Rego) → engine:; lint scope/glob нормалізується (string → array); extensionsSlot проходить у LintSurface; не-string ігнорується; ще 3

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
