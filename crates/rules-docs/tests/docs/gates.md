---
type: Rust Module
title: gates.rs
resource: crates/rules-docs/tests/gates.rs
docgen:
  crc: b99fed1e
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 80
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Дзеркальний набір обох семантичних гейтів — сценарій-у-сценарій із `tests/entailment.test.mjs` і `tests/gap-mappings.test.mjs`, плюс пін-и проти ЖИВИХ значень JS (хеші й побайтовий промпт зняті з Node, не відтворені з голови).  Асерти на `evaluateGaps` із JS-набору сюди не перенесені свідомо: gap-engine — детермінований модуль, що цим зрізом не портується. Його статуси (`satisfied`/`missing`/`diverged`/`unresolved`) перевіряються тут опосередковано — через рівно ті `mappings` і `unresolved…`, які він читає.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Кешує результати в межах одного прогону.
