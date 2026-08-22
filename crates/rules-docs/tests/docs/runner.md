---
type: Rust Module
title: runner.rs
resource: crates/rules-docs/tests/runner.rs
docgen:
  crc: fe324b1a
  model: local-openai/gemma-4-26b-a4b-it
  tier: local-min
  score: 70
---

## Огляд

Набір самодостатніх деталей оркестратора.  JS-набір (`tests/runner.test.mjs`) перевіряє ці функції лише крізь увесь конвеєр — вони не експортуються. Тому фікстура `fixtures/js-runner.json` знята ІНАКШЕ: живий `buildPackageKnowledge` прогнано в Node із перехоплювальними інʼєкціями, і з нього збережено рівно те, що оркестратор передає далі — відбиток джерел, chunk-и claims разом із їхніми промптами, приватний індекс evidence і реєстр захищених зон. Тобто звіряється не переказ JS-логіки, а її фактичний вихід.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
