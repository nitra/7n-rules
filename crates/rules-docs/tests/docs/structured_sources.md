---
type: Rust Module
title: structured_sources.rs
resource: crates/rules-docs/tests/structured_sources.rs
docgen:
  crc: 0a8e7431
  model: local-openai/gemma-4-26b-a4b-it
  tier: local-min
  score: 60
---

## Огляд

Дзеркальний набір структурованих джерел — сценарій-у-сценарій із `tests/structured-sources.test.mjs`, плюс диференційна звірка ВСІХ шести фрагментів із живим JS.  Звірка тут критична: `config:`/`schema:`/`contract:`/`evidence:`/`edge:` і ID кожного твердження — це digest-и, тож дрейф формули тихо перебудував би граф контрактів домену.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
