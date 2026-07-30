---
type: JS Module
title: identity-migration.mjs
resource: npm/rules/doc-files/package_knowledge/identity-migration.mjs
docgen:
  crc: 2a6fd845
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
  score: 80
---

## Огляд

Зіставляє previous і newly discovered topics, щоб rename не втрачав stable
identity або protected narrative. Невизначений split/merge повертає plan і
блокує candidate замість вибору за порядком обходу.

## Публічний API

- reconcileTopicIdentities — Reconciles newly discovered topics against a committed manifest. Exact IDs
remain unchanged; a unique high-confidence rename receives the old canonical
ID and retains its aliases. Split/merge and protected-zone uncertainty return
an explicit plan without silently selecting a topic.

## Сценарії використання

- `npm/rules/doc-files/package_knowledge/tests/identity-migration.test.mjs` (reconcileTopicIdentities) — keeps topic ID, aliases and narrative mapping when an unchanged file moves; recognizes a symbol rename from semantic signature and graph neighborhood; blocks ambiguous splits and merges with an explicit migration plan; preserves a protected MANUAL/EXPECTED registry only through an unambiguous mapping; orders mappings and topics identically regardless of input ordering

## Гарантії поведінки

- (специфічних машинно-виведених гарантій немає)
