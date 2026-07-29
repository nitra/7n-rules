---
type: JS Module
title: structured-sources.mjs
resource: npm/rules/ci4/package_knowledge/structured-sources.mjs
---

## Огляд

`structured-sources.mjs` deterministic-но виявляє package-owned manifest, structured config, OpenAPI, AsyncAPI, GraphQL та JSON Schema artifacts. Він використовує лише native parsers і повертає blocking diagnostic для malformed recognized artifact замість whole-file fallback.

## Поведінка

`loadStructuredSources` не переходить у nested documentation domains, не слідує symlink за domain boundary та зберігає exact relative path і SHA-256 content hash як evidence. Internal schema відображається як `config` node з `artifact: schema`; external API boundary — як `integration` node, а schema provenance — як `evidence.kind: schema` відповідно до graph schema v1.

`mergeStructuredFragments` перевіряє injected fragments, evidence provenance та local edges перед детермінованим merge у normalized language graph. Duplicate identity або malformed fragment зупиняють candidate. `runner` викликає discovery після language source loading і передає fragments у candidate; blocking loader result не доходить до claims, render або publication. Loader також повертає exact parsed artifact text у `evidenceContentById` для downstream entailment verification без повторного filesystem read.

## Публічний API

- `loadStructuredSources({ domain })` — читає й парсить structured artifacts одного domain.
- `mergeStructuredFragments({ graph, domain, fragments })` — додає валідні structured nodes, edges і evidence до graph.

## Сценарії використання

- `tests/structured-sources.test.mjs` — OpenAPI/manifest/config evidence, malformed contract blocker і nested-domain exclusion.

## Гарантії поведінки

- Legacy або arbitrary docs не є artifact-ами без deterministic recognition.
- Malformed recognized artifact не породжує partial projection.
