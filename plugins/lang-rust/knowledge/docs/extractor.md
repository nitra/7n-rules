---
type: JS Module
title: extractor.mjs
resource: plugins/lang-rust/knowledge/extractor.mjs
docgen:
  crc: 6b78648a
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Будує fail-closed normalized fragments для Rust package-knowledge.

Adapter використовує Tree-sitter WASM з офіційною Rust grammar. Старий
doc-files scanner навмисно не імпортується: regex/brace-пошук не є джерелом
production semantic graph. Будь-яка parser/runtime помилка повертає лише
blocking diagnostic, без partial fragment-а або whole-file fallback.

## Публічний API

- analyzeFile — Аналізує один Rust source-file через Tree-sitter WASM.
- collectTestScenarios — Збирає active #[test] scenarios та assert!/assert_* macros через Rust grammar.

## Сценарії використання

- `plugins/lang-rust/knowledge/tests/extractor.test.mjs` (knowledge.extractor@1 Rust adapter) — декларує versioned Tree-sitter WASM contract для .rs; будує public/private units, AST imports і local/opaque call edges; UTF-8 spans лишаються byte-stable для unicode перед declaration-ом; malformed Rust повертає blocking parse diagnostic без partial graph; unsupported extension повертає явний blocking diagnostic

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Кешує результати в межах одного прогону.
