---
type: JS Module
title: render.mjs
resource: npm/rules/ci4/package_knowledge/render.mjs
docgen:
  crc: 59471d4a
---

## Огляд

Детерміновано перетворює один validated package knowledge graph на candidate
Markdown pages і schema-compatible manifest без викликів LLM або publication.
Згенеровані сторінки мають hashed `AUTOGEN` zones; наявні `MANUAL` та
`EXPECTED` zones зберігаються через zone contract.

## Публічний API

- `renderKnowledgeArtifacts` — повертає in-memory file map для index, meaningful
  topic/architecture/gap pages і `docs/.docgen/manifest.json`; блокує невалідний
  graph або authored page без оголошеного `AUTOGEN` target.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/render.test.mjs` — рендерить лише
  meaningful views, зберігає byte determinism, не створює gap page без
  actionable gap, не розкриває private symbols і зберігає protected zones.

## Гарантії поведінки

- Human Markdown не містить private names або IDs; private traceability лишається
  лише в manifest.
- Topic fragments materialize local implemented/expected claims, outcomes,
  contracts і reverse impact paths без непідтвердженого narrative.
