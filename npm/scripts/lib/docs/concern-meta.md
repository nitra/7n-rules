---
type: JS Module
title: concern-meta.mjs
resource: npm/scripts/lib/concern-meta.mjs
docgen:
  crc: d452f9b7
  model: omlx/gemma-4-e2b-it-4bit
  tier: local-min
  score: 80
---

## Огляд

Парсер і нормалізатор `concern.json`. Єдине місце де читається і валідується схема concern-а.

## Публічний API

- readConcernMeta — Читає і нормалізує `concern.json` з каталогу.
Повертає `null` якщо файл відсутній або не валідний.
- listConcerns — Сканує підкаталоги `ruleDir` і повертає всі concern-и (у алфавітному порядку).
Каталоги без `concern.json` ігноруються.

## Сценарії використання

- `npm/scripts/lib/tests/concern-meta.test.mjs` (concern-meta — policy.engine derivation; concern-meta — lint surface) — явний engine:; legacy check:; legacy без engine/check (Rego) → engine:; lint scope/glob нормалізується (string → array); skipLocalTier: true нормалізується, дефолт — false; ще 2

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
