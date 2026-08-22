---
type: Rust Module
title: pipeline.rs
resource: crates/rules-docs/tests/pipeline.rs
docgen:
  crc: dc79df2c
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 70
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Дзеркальний набір конвеєра `docs build` — сценарій-у-сценарій із `tests/runner.test.mjs`.  Одна принципова різниця з JS-набором. Там кожна стадія підмінялась інʼєкцією (`renderImpl`, `verifyEntailmentImpl`, `compareGapMappingsImpl`, …), тож перевірялась ПРОВОДКА між заглушками. Тут заглушка одна — транспорт; домен лежить на диску, а всі стадії справжні. Тому ці тести кажуть більше: «стадія не викликалась» стає «жодного виклику моделі не було», а «render не викликався» — «дерево доків не змінилось».

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Кешує результати в межах одного прогону.
