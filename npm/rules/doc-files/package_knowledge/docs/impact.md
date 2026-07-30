---
type: JS Module
title: impact.mjs
resource: npm/rules/doc-files/package_knowledge/impact.mjs
docgen:
  crc: 8401222c
  model: openai-codex/gpt-5.4-mini
  tier: cloud-min
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

- `npm/rules/doc-files/package_knowledge/tests/impact.test.mjs` (createImpactSlice) — returns domain-contained impact sets without private symbol names; accepts topic alias and rejects a topic from another domain

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
