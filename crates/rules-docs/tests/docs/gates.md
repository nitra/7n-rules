---
type: Rust Module
title: gates.rs
resource: crates/rules-docs/tests/gates.rs
docgen:
  crc: c40cd51d
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 80
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Дзеркальний набір обох семантичних гейтів — сценарій-у-сценарій із `tests/entailment.test.mjs` і `tests/gap-mappings.test.mjs`, плюс пін-и проти ЖИВИХ значень JS (хеші й побайтовий промпт зняті з Node, не відтворені з голови).  Асерти на `evaluateGaps` тут ПОВНІ: comparator і двигун вердиктів перевіряються разом, як у JS-наборі. Сенс саме в парі — comparator може віддати формально валідні `mappings`, з яких двигун зробить не той статус; окремо ця розбіжність не видно.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Кешує результати в межах одного прогону.
