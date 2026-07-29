---
type: JS Module
title: expected-overlay.mjs
resource: npm/rules/ci4/package_knowledge/expected-overlay.mjs
docgen:
  crc: f2351a91
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Додає лише явно задані expected claims до evidence-backed knowledge graph.

Модуль не інтерпретує prose і не зіставляє claims: він зберігає protected
expectation як окремий шар, щоб gap engine міг порівнювати його з AS-IS.

## Публічний API

- applyExpectedOverlay — Adds explicit expected claims and evidence without mutating the input graph.

Existing graph evidence can be referenced directly; new evidence is optional
and must have unique IDs. Every expectation stays evidence-backed and points
at a node in the current domain, otherwise publication is blocked.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/expected-overlay.test.mjs` (applyExpectedOverlay) — adds explicit expected claim immutably in stable order; blocks expectation without evidence instead of publishing unsupported intent; blocks references to a subject outside the domain graph; adds new expectation evidence and rejects malformed overlay contracts; blocks duplicate, unknown and invalid expectation evidence

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
