---
type: JS Module
title: runner.mjs
resource: npm/rules/ci4/package_knowledge/runner.mjs
docgen:
  crc: 9c16a8fb
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 60
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Оркеструє повну генерацію package knowledge у shadow або publish режимі.

Runner не має власної semantic schema: він послідовно з'єднує наявні
resolver, adapters, parser candidate, planner, claims, renderer, validator
та atomic publisher. Усі залежності інʼєктовані, щоб tests перевіряли
fail-closed межі без реальних plugin або LLM викликів.
Після Expected overlay runner верифікує evidence entailment, автоматично
порівнює expected↔implemented claims і лише тоді materializes gaps/render.
Перед semantic роботою source inventory fail-closed перевіряє language
adapters; package без code може пройти contract-only шлях без LLM claims.

## Публічний API

- buildPackageKnowledge — Builds one package knowledge domain. The default is SHADOW: candidate docs
are validated and materialized under the system cache, never under domain docs.
`publish: true` is the only path that invokes the existing atomic publisher.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/runner.test.mjs` (buildPackageKnowledge) — passes the discovered inventory to adapter and source loaders before candidate work; blocks inventory diagnostics before adapters, source loading and LLM work; blocks a discovered extension when its adapter plugin is missing; builds a contract-only package without extractors, source loader or LLM claims; SHADOW validates and stages candidate, then unchanged cache performs zero LLM calls; ще 12

## Гарантії поведінки

- Кешує результати в межах одного прогону.
