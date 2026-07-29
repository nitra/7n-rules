---
type: JS Module
title: expected-sources.mjs
resource: npm/rules/ci4/package_knowledge/expected-sources.mjs
docgen:
  crc: a03ffef6
---

## Огляд

Збирає explicit expectation evidence для одного documentation domain і строго
мапить його на canonical graph IDs. `EXPECTED` zones є локальними source-ами,
а ADR/spec приймаються лише з exact `PACKAGE-KNOWLEDGE:domain` marker-ом та
accepted ADR status.

## Публічний API

- `discoverExpectedSources` збирає protected zones, scoped ADR/spec і active
  JS/TS assertion scenarios у deterministic order.
- `mapExpectedSources` будує evidence-backed expected overlay через per-source
  `min → avg → max` ladder; successful unchanged results беруться з cache.
- `collectActiveTestScenarios` і `parseExpectedSourceResult` дають strict
  OXC/JSON boundaries для focused tests.

## Гарантії поведінки

- Відсутність sources повертає порожній overlay і не робить model call.
- Disabled JS/TS tests не формують expectation самі по собі.
- Unknown node/evidence IDs, malformed JSON, ambiguous scope і non-JS test без
  full language parser блокують publication; regex fallback не використовується.
