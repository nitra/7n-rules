---
type: JS Module
title: impact.mjs
resource: npm/rules/ci4/package_knowledge/impact.mjs
docgen:
  crc: d33c625d
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
---

## Огляд

Будує privacy-safe impact slice для одного package-knowledge topic.

Slice використовує private units лише як внутрішні traversal vertices. Назви
та identifiers private symbols не повертаються, тоді як affected files,
tests, configs і external contracts лишаються доступними для change plan.

## Публічний API

- createImpactSlice — Повертає domain-contained impact set за topic ID або alias.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/impact.test.mjs` (createImpactSlice) — returns domain-contained impact sets without private symbol names; accepts topic alias and rejects a topic from another domain

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
