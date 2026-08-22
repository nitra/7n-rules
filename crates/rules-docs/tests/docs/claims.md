---
type: Rust Module
title: claims.rs
resource: crates/rules-docs/tests/claims.rs
docgen:
  crc: 1b3a1499
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 80
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Дзеркальний набір map/reduce-конвеєра claims — сценарій-у-сценарій із `tests/claims.test.mjs`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Кешує результати в межах одного прогону.
