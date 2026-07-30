---
type: JS Module
title: candidate.mjs
resource: npm/rules/doc-files/package_knowledge/candidate.mjs
docgen:
  crc: bfcebe67
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Збирає повний deterministic package-knowledge candidate з source files.

Оркестратор не виконує LLM synthesis і не публікує artifacts. Він fail-closed
зʼєднує language extractors, normalized graph, explicit Expected overlay,
gap engine, topic discovery та quality gates в одну атомарну операцію.

## Публічний API

- buildKnowledgeCandidate — Будує complete validated graph candidate без publication.

## Сценарії використання

- `npm/rules/doc-files/package_knowledge/tests/candidate.test.mjs` (buildKnowledgeCandidate) — builds a complete graph in stable source order; applies explicit expectations and deterministic gaps; merges injected structured config and contract fragments before graph validation; integrates previous-manifest identity migration into candidate discovery; blocks missing extractors and thrown parser calls without partial graph; ще 1

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
