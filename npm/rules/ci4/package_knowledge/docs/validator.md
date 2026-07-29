---
type: JS Module
title: validator.mjs
resource: npm/rules/ci4/package_knowledge/validator.mjs
docgen:
  crc: 7233ac98
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 75
---

## Огляд

Виконує deterministic quality gates для package knowledge graph.

Validator перевіряє public schema, referential integrity, extractor coverage
і privacy human projection. Він не виправляє й не публікує candidate: будь-яка
діагностика лишає рішення про atomic publication зовнішньому caller-у.

## Публічний API

- validateKnowledgeGraph — Запускає schema, identity, coverage, reference і privacy gates.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/validator.test.mjs` (validateKnowledgeGraph) — accepts a schema-valid, complete and private-safe graph; blocks incomplete extractor coverage without converting it to a gap; blocks broken references and domain identity mismatch; blocks private names in human projection but keeps them legal in graph; returns schema diagnostics before semantic traversal

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
