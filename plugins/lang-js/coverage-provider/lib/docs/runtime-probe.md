---
type: JS Module
title: runtime-probe.mjs
resource: plugins/lang-js/coverage-provider/lib/runtime-probe.mjs
docgen:
  crc: 427f2a8e
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Runtime probing of exported functions.

Three probe strategies — all best-effort (return {} on any failure):

1. probeModule  — calls each export with edge-case primitives, returns actual outputs.
2. probeFetchCalls — intercepts globalThis.fetch to capture real URL/init per export.
3. probeTimeVariants — runs each export at hours [0,9,14,22], reports time-sensitive ones.
4. probeHelpers — extracts non-exported helper functions from source and calls them
   with generic param combos to reveal their actual output shapes.

## Публічний API

- describeShape — Рекурсивно описує форму значення без самих даних.
- capProbeOutput — Обмежує серіалізований probe-вихід: до `PROBE_OUTPUT_MAX_CHARS` — без змін,
довший — shape-summary замість значення (модель бачить структуру для
asserts на форму, але не тягне дамп у промпт і не копіює його в expected).
- probeModule — Пробує експорти модуля у дочірньому процесі й повертає фактичні виходи.
- probeFetchCalls — Перехоплює `fetch` і збирає реальні URL/init, які будує кожен export.
- probeTimeVariants — Запускає кожен export у кількох годинах доби й повертає time-sensitive варіанти.
- probeHelpers — Витягує неекспортовані helper-и з source та проганяє їх крізь generic param combos.
Best-effort: повертає `{}` при будь-якій помилці.

## Сценарії використання

- `plugins/lang-js/coverage-provider/tests/runtime-probe.test.mjs` (runtime-probe.mjs; describeShape) — describes primitives and null; describes an array of objects with nested shapes; truncates long key lists with an ellipsis; collapses to a bare marker at depth 0; returns short output unchanged; ще 5

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
