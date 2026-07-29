---
type: JS Module
title: render.mjs
resource: npm/rules/ci4/package_knowledge/render.mjs
docgen:
  crc: 876c85ce
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 75
---

## Огляд

Рендерить deterministic Markdown і manifest-проєкції package knowledge graph.

Модуль не аналізує source, не викликає LLM і не публікує файли. Він створює
повний candidate file map, а publication лишається відповідальністю
`publish.mjs` після окремої validation-перевірки.
Людські AS-IS сторінки групують лише evidence-backed business/architecture
claims, а private symbol names зберігаються тільки у machine manifest.

## Публічний API

- renderKnowledgeArtifacts — Renders candidate Markdown pages and a schema-compatible manifest.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/render.test.mjs` (renderKnowledgeArtifacts) — renders only meaningful views, an actionable gaps page and schema-compatible manifest; renders a dedicated capability page when a deterministic topic supplies one; is byte-deterministic and does not create empty page trees or gaps without an explicit gap; does not leak private names into human Markdown; renders a detailed planning fragment from behavioral claims while keeping private facts semantic-only; ще 3

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
