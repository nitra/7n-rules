---
type: JS Module
title: extractor.mjs
resource: plugins/lang-js/knowledge/extractor.mjs
docgen:
  crc: d2bbb828
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Будує fail-closed normalized fragments для JS/TS/Vue package-knowledge.

Adapter використовує OXC для всіх script-файлів, а `@vue/compiler-sfc` і
`@vue/compiler-dom` — для SFC/template AST. Він не має whole-file fallback:
parser або непокритий template expression повертає blocking diagnostic.

## Публічний API

- collectTestScenarios — Збирає active Vitest/Jest-style assertion scenarios через OXC AST.
- analyzeFile — Аналізує один JS/TS/Vue source-file у deterministic normalized fragment.

## Сценарії використання

- `plugins/lang-js/knowledge/tests/extractor.test.mjs` (knowledge.extractor@1 JS adapter) — декларує versioned parser contract і всі JS/Vue extensions; будує units, imports, internal/opaque edges, chunks і coverage з UTF-8 byte spans; OXC parse error блокує publication без partial graph або fallback; Vue script setup проходить через compiler-sfc і OXC, зберігаючи spans оригінального SFC; Vue template утворює units та edges для unicode handler, local call і component boundary; ще 1

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
