---
type: JS Module
title: validator.mjs
resource: npm/rules/doc-files/package_knowledge/validator.mjs
docgen:
  crc: d867e24e
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
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

- `npm/rules/doc-files/package_knowledge/tests/validator.test.mjs` (validateKnowledgeGraph) — accepts a schema-valid, complete and private-safe graph; blocks incomplete extractor coverage without converting it to a gap; blocks broken references and domain identity mismatch; blocks private names in human projection but keeps them legal in graph; returns schema diagnostics before semantic traversal

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
