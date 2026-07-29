---
type: JS Module
title: chunk-planner.mjs
resource: npm/rules/ci4/package_knowledge/chunk-planner.mjs
docgen:
  crc: c9282aed
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Планує bounded semantic chunks і dependency waves для package knowledge.

Planner працює лише з already-normalized graph і точними UTF-8 source spans.
Він не виконує LLM calls і не публікує документацію: результат є
детермінованим execution plan для map/reduce orchestration.

## Публічний API

- planSemanticChunks — Планує normalized semantic units і edges у bounded map chunks та dependency waves.

Default required nodes — усі `code-unit` nodes; opaque cross-domain targets
не є AST units, але їхні incoming edges лишаються required і покриваються
source evidence slice свого local caller. Explicit `requiredNodeIds` дозволяє
higher-level graph layer планувати інші node kinds тільки за наявності spans.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/chunk-planner.test.mjs` (planSemanticChunks) — uses exact UTF-8 byte slices and rejects a span through a unicode code point; keeps cycles in one SCC chunk and schedules dependencies before callers; is byte-stable across input order and fingerprints all cache policy inputs; covers every required node and edge instead of truncating a tail for the budget; plans only code-unit-originated edges by default while retaining structured graph relations; ще 1

## Гарантії поведінки

- Кешує результати в межах одного прогону.
