---
type: JS Module
title: extractor.mjs
resource: plugins/lang-python/knowledge/extractor.mjs
docgen:
  crc: c164a7cc
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Будує fail-closed normalized fragments для Python package-knowledge.

Adapter використовує повний Tree-sitter Python parser у WASM. Він не
застосовує regex або indent scanner для source-семантики: ERROR node,
невідомий import wildcard чи помилка ініціалізації блокують publication.

## Публічний API

- analyzeFile — Аналізує один Python source-file у deterministic normalized fragment.

## Сценарії використання

- `plugins/lang-python/knowledge/tests/extractor.test.mjs` (knowledge.extractor@1 Python adapter) — декларує Tree-sitter WASM parser contract і Python extension; будує public/private units, imports, semantic edges, chunks і coverage з UTF-8 byte spans; parser error блокує publication без partial graph або fallback; unsupported source extension та wildcard import мають blocking diagnostics

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
