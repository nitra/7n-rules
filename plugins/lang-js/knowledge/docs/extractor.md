---
type: JS Module
title: extractor.mjs
resource: plugins/lang-js/knowledge/extractor.mjs
docgen:
  crc: 5dabaef6
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 70
---

## Огляд

Будує fail-closed normalized fragments для JS/TS/Vue package-knowledge.

Adapter використовує OXC для всіх script-файлів та existing `vueScriptBlock`
для SFC. Він не має whole-file fallback: помилка parser-а або template, для
якого ще не реалізовано semantic edges, повертає blocking diagnostic.

## Публічний API

- analyzeFile — Аналізує один JS/TS/Vue source-file у deterministic normalized fragment.

## Сценарії використання

- `plugins/lang-js/knowledge/tests/extractor.test.mjs` (knowledge.extractor@1 JS adapter) — декларує versioned parser contract і всі JS/Vue extensions; будує units, imports, internal/opaque edges, chunks і coverage з UTF-8 byte spans; OXC parse error блокує publication без partial graph або fallback; Vue script setup проходить через compiler-sfc і OXC, зберігаючи spans оригінального SFC; Vue template без template-edge analyzer-а повертає explicit blocking diagnostic

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
