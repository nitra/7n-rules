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

Публікує validated package knowledge artifacts атомарною заміною docs tree та прибирає лише stale canonical package-knowledge pages, підтверджені попереднім manifest і валідними AUTOGEN markers.

Staging на тому самому volume і rollback гарантують, що parser, validator,
protected-zone failure або migration blocker не залишить частково оновлену документацію. Legacy file docs не видаляються; obsolete generated page з `MANUAL`/`EXPECTED` або authored text блокує publication до явної migration.

## Публічний API

- publishKnowledgeArtifacts — Atomically publishes caller-validated docs candidates. All writes first land in a same-volume
staging directory; a failed validator, zone check or staging operation leaves committed docs
and manifest bytes untouched.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/publish.test.mjs` (atomic package knowledge publication) — validates requests and caller gates before filesystem mutation; preserves protected zones; removes obsolete canonical generated pages without touching legacy file docs; blocks protected stale pages before swap; ще 1

## Гарантії поведінки

- Видаляє лише canonical package-knowledge Markdown з exact AUTOGEN ownership, підтверджений previous manifest.
- MANUAL, EXPECTED і authored text на obsolete generated page є fail-closed migration blocker-ами.
