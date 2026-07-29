---
type: JS Module
title: publish.mjs
resource: npm/rules/ci4/package_knowledge/publish.mjs
docgen:
  crc: a313cb21
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 75
---

## Огляд

Публікує validated package knowledge artifacts атомарною заміною docs tree.

Staging на тому самому volume і rollback гарантують, що parser, validator
або protected-zone failure не залишить частково оновлену документацію.

## Публічний API

- publishKnowledgeArtifacts — Atomically publishes caller-validated docs candidates. All writes first land in a same-volume
staging directory; a failed validator, zone check or staging operation leaves committed docs
and manifest bytes untouched.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/publish.test.mjs` (atomic package knowledge publication) — rejects invalid requests before touching the filesystem; turns validator exceptions into blocking diagnostics; caller validation failure leaves docs and manifest byte-identical; publishes through stage only after validation and preserves protected zones; protected-zone conflict aborts before replacing committed docs; ще 1

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
