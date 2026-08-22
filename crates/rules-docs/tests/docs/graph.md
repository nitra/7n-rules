---
type: Rust Module
title: graph.rs
resource: crates/rules-docs/tests/graph.rs
docgen:
  crc: ef2f145f
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 75
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Дзеркальний набір побудови графа — сценарії з `tests/normalized-graph.test.mjs` плюс повна диференційна звірка з живим JS (`fixtures/js-graph.json`).  Звірка тут головна: `evidence:`, `edge:` і `contract:` — це хеші, тож будь-який дрейф (порядок ключів у хешованому JSON, обрізка до 24 символів, фолбек ролі) тихо перебудував би ідентичності всього графа.  Сценарій «граф проходить committed v1 schema» не переноситься: він перевіряє Ajv-валідацію, тобто `validator.mjs`, який лишається наступним окремим зрізом.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
