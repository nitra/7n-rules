---
type: JS Module
title: render.mjs
resource: npm/rules/ci4/package_knowledge/render.mjs
docgen:
  crc: d1ca9c47
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min-retry
  score: 75
---

## Огляд

Рендерить claim-driven українські AS-IS fragments: показує лише підтверджені
purpose, flow, rules, state, boundaries та outcomes, а private symbol names
залишає тільки у manifest traceability.

Рендерить deterministic Markdown і manifest-проєкції package knowledge graph.

Модуль не аналізує source, не викликає LLM і не публікує файли. Він створює
повний candidate file map, а publication лишається відповідальністю
`publish.mjs` після окремої validation-перевірки.

## Публічний API

- renderKnowledgeArtifacts — Renders candidate Markdown pages and a schema-compatible manifest.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/render.test.mjs` (renderKnowledgeArtifacts) — renders only meaningful views, an actionable gaps page and schema-compatible manifest; renders a dedicated capability page when a deterministic topic supplies one; is byte-deterministic and does not create empty page trees or gaps without an explicit gap; does not leak private names into human Markdown; updates AUTOGEN while preserving supplied MANUAL and EXPECTED zones; ще 1

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
