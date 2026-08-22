---
type: Rust Module
title: sources.rs
resource: crates/rules-docs/tests/sources.rs
docgen:
  crc: 48eecb9a
  model: local-openai/gemma-4-26b-a4b-it
  tier: local-min
  score: 80
---

## Огляд

Дзеркальний набір завантажувача джерел — сценарій-у-сценарій із `tests/source-loader.test.mjs`.  Три сценарії тут про МЕЖУ домену: вкладений пакет, згенероване дерево і symlink назовні. Кожен із них — спосіб тихо втягнути в документацію код, якого домен не має описувати.

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
