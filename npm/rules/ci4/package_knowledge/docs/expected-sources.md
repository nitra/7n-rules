---
type: JS Module
title: expected-sources.mjs
resource: npm/rules/ci4/package_knowledge/expected-sources.mjs
docgen:
  crc: e30c5c02
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 80
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Знаходить explicit Expected sources і строго мапить їх на package graph.

Markdown zones/ADR/spec scope та parser-backed JS/Rust/Python/PHP test scenarios
збираються детерміновано. Expected claims використовують ту саму stable
behavioral taxonomy, що й Implemented claims.
LLM бачить лише source evidence і canonical graph IDs; malformed або ambiguous
result блокує candidate, а не перетворюється на припущення про expectation.

## Публічний API

- discoverExpectedSources — Знаходить authored Markdown і parser-backed executable tests, що є sources explicit expectation.
ADR/spec беруться лише за exact domain marker; локальні EXPECTED zones already
belong to owning domain. Disabled tests не створюють source без corroboration.
- parseExpectedSourceResult — Перевіряє raw LLM mapping result against current canonical graph references.
- mapExpectedSources — Мапить discovered explicit sources до existing canonical graph IDs via strict
per-source model ladder. Empty input bypasses transport completely.

## Сценарії використання

- `npm/rules/ci4/package_knowledge/tests/expected-sources.test.mjs` (Expected source discovery; Expected source mapping) — collects EXPECTED zone, scoped accepted ADR/spec and active assertion scenario in stable order; accepts an order; does not turn disabled tests into expectation without a corroborating source; discovers a non-JS test through its full-parser adapter; collects Rust assertions only from active #[test] functions; ще 3

## Гарантії поведінки

- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
