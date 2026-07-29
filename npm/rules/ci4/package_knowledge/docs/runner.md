---
type: JS Module
title: runner.mjs
resource: npm/rules/ci4/package_knowledge/runner.mjs
docgen:
  crc: ed06d63d
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

Перед adapter loading runner inventory-ить фактично присутні code extensions у domain і передає їх як `requiredExtensions`. Inventory blocker зупиняє pipeline до adapters, source loading і LLM work. Якщо inventory порожній, package може бути contract-only: runner не вимагає extractor, не викликає language source loader/planner/claims та будує candidate із structured artifacts.

## Публічний API

- buildPackageKnowledge — Builds one package knowledge domain. The default is SHADOW: candidate docs
are validated and materialized under the system cache, never under domain docs.
`publish: true` is the only path that invokes the existing atomic publisher.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/runner.test.mjs` — inventory/adapters/source ordering, missing language plugin blocker, contract-only package і SHADOW/publish pipeline.

## Гарантії поведінки

- Кешує результати в межах одного прогону.
