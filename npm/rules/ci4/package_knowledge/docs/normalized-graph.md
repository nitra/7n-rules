---
type: JS Module
title: normalized-graph.mjs
resource: npm/rules/ci4/package_knowledge/normalized-graph.mjs
docgen:
  crc: 9af5e4a6
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Будує детермінований package-level knowledge graph із нормалізованих
language fragments.

Core, а не language adapter, володіє canonical ID, opaque cross-domain
boundaries і provenance. Будь-який extractor failure або порушення contract
блокує весь graph: partial result не повертається і не може бути опублікований.

## Публічний API

- createCodeUnitId — Створює canonical code-unit ID, незалежний від фізичного шляху файла.
- buildNormalizedGraph — Будує normalized graph. Language fragments можуть надходити у будь-якому
порядку; результат і diagnostics завжди стабільно відсортовані.
- serializeKnowledgeGraph — Серіалізує graph у byte-stable JSON для manifest, snapshot і reproducible fingerprints.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/normalized-graph.test.mjs` (buildNormalizedGraph) — gives byte-identical output for differently ordered fragments and attributes; keeps private units in traceability graph without changing their visibility; represents external dependencies as opaque contract nodes; fails the complete graph when any extractor result failed; rejects semantic edges without evidence instead of publishing assumptions; ще 2

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
