---
type: Rust Module
title: candidate.rs
resource: crates/rules-docs/tests/candidate.rs
docgen:
  crc: 709d56a0
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 70
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Дзеркало `npm/rules/doc-files/package_knowledge/tests/candidate.test.mjs` — сценарій у сценарій, плюс випадки, яких JS-набір не має, бо в JS вони неможливі або невиразні (конфлікт розширень, небезпечний шлях, dotfile).

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
