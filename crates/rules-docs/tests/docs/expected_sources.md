---
type: Rust Module
title: expected_sources.rs
resource: crates/rules-docs/tests/expected_sources.rs
docgen:
  crc: d496255a
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 75
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Дзеркальний набір джерел очікувань — сценарії з `tests/expected-sources.test.mjs`, які належать САМЕ цьому модулю, плюс диференційна звірка ідентичностей із живим JS.  Чотири сценарії JS-набору сюди не переносяться: вони перевіряють мовні екстрактори (`collectTestScenarios` для JS/Rust/PHP/Python), тобто заблоковану слот-поверхню (§5.0.15 реєстру), а не цей модуль. Точка їх підключення тут перевіряється інʼєкцією.

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Кешує результати в межах одного прогону.
