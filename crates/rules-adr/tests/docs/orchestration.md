---
type: Rust Module
title: orchestration.rs
resource: crates/rules-adr/tests/orchestration.rs
docgen:
  crc: f716e59f
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 80
---

## Огляд

cspell:ignore Оркестраційні existuyucha funkciya драфтовий Оркестраційні тести batch-хвиль `normalize_pipeline` — дзеркало `npm/scripts/lib/adr/tests/normalize-pipeline-orchestration.test.mjs` сценарій-у-сценарій: інжектований submit відповідає за префіксом `customId` (`dd:`/`dc:`/`kind:`/`gen:`/`merge:`), рахує хвилі й items.

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Кешує результати в межах одного прогону.
