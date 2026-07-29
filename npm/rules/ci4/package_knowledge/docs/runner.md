---
type: JS Module
title: runner.mjs
resource: npm/rules/ci4/package_knowledge/runner.mjs
docgen:
  crc: b6dd58c2
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 75
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Оркеструє повну генерацію package knowledge у shadow або publish режимі.

Runner не має власної semantic schema: він послідовно з'єднує наявні
resolver, adapters, parser candidate, implemented claims, Expected source
mapping, renderer, validator та atomic publisher. Усі залежності інʼєктовані, щоб tests перевіряли
fail-closed межі без реальних plugin або LLM викликів.

## Публічний API

- buildPackageKnowledge — Builds one package knowledge domain. The default is SHADOW: candidate docs
are validated and materialized under the system cache, never under domain docs.
`publish: true` is the only path that invokes the existing atomic publisher.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/runner.test.mjs` (buildPackageKnowledge) — SHADOW validates and stages candidate, then unchanged cache performs zero LLM calls; parser failure is fail-closed and does not replace existing docs; explicit publish atomically adds generated views and preserves unrelated legacy docs; ingests automatic Expected overlay only after implemented claims are available

## Гарантії поведінки

- Читає existing docs і previous manifest до candidate build, щоб protected topic zones переживали migration.
- Мапить automatic Expected sources після implemented claims, а injected overlay додає тим самим fail-closed contract.
