---
type: JS Module
title: expected-sources.mjs
resource: npm/rules/doc-files/package_knowledge/expected-sources.mjs
docgen:
  crc: 330bd2c3
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
---

## Огляд

Знаходить explicit Expected sources і строго мапить їх на package graph.

Markdown zones/ADR/spec scope та parser-backed JS/Rust/Python/PHP test scenarios
збираються детерміновано. Expected claims використовують ту саму stable
behavioral taxonomy, що й Implemented claims.
LLM бачить лише source evidence і canonical graph IDs; malformed або ambiguous
result блокує candidate, а не перетворюється на припущення про expectation.

## Поведінка

discoverExpectedSources повертає або набір детермінованих знайдених джерел, або діагностику-блокер, якщо неможливо визначити джерела на основі маркера домену або тестів. Сценарії, що є джерелами, відрізняються від тих, що знаходяться вхідного домену.

parseExpectedSourceResult повертає або набір заяв, що пройшли строгий перевірку порівняно з відомими графовими посиланнями, або причину відмови, якщо результат мапінгу не відповідає очікуваним графовим посиланням.

mapExpectedSources повертає або фінальний оверлей із заяв та доказами, або діагностику-блокер, якщо процес мапінгу не вдається. Під час виконання мапінгу каталоги `.git` та `node_modules` ігноруються.

## Публічний API

- discoverExpectedSources — Знаходить authored Markdown і parser-backed executable tests, що є sources explicit expectation.
ADR/spec беруться лише за exact domain marker; локальні EXPECTED zones already
belong to owning domain. Disabled tests не створюють source без corroboration.
- parseExpectedSourceResult — Перевіряє raw LLM mapping result against current canonical graph references.
- mapExpectedSources — Мапить discovered explicit sources до existing canonical graph IDs via strict
per-source model ladder. Empty input bypasses transport completely.

## Сценарії використання

- `npm/rules/doc-files/package_knowledge/tests/expected-sources.test.mjs` (Expected source discovery; Expected source mapping) — collects EXPECTED zone, scoped accepted ADR/spec and active assertion scenario in stable order; accepts an order; does not turn disabled tests into expectation without a corroborating source; discovers a non-JS test through its full-parser adapter; collects Rust assertions only from active #[test] functions; ще 4

## Гарантії поведінки

- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Кешує результати в межах одного прогону.
- Свідомо пропускає шляхи: `.git`, `node_modules`.
