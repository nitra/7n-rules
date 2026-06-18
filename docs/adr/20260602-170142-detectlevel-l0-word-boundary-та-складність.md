---
type: ADR
title: "detectLevel: матчення L0-дієслів цілими словами та перекриття сигналом складності"
---

# detectLevel: матчення L0-дієслів цілими словами та перекриття сигналом складності

**Status:** Accepted
**Date:** 2026-06-02

## Context and Problem Statement

`detectLevel` у `npm/scripts/dispatcher/lib/level.mjs` мав два дефекти: L0-дієслова матчились як підрядки (`'add prefix validation'` → L0 через `fix` ⊆ `prefix`); описи із сигналом складності (`mdc`, `rego`, `policy`, `checker`) разом із L0-дієсловом також отримували L0, пропускаючи spec-крок.

## Considered Options

**Word-boundary:** матчення за word-boundary regex (ASCII-ключі) vs підрядком.

**Complexity signal:** COMPLEXITY_KEYS → L2 (пріоритет L3 > L2∪складність > L0 > L1); або → L1; або прибрати `fix` із L0_KEYS.

## Decision Outcome

Chosen option (word-boundary): "word-boundary regex", because вузький hygiene-фікс без порушення пріоритетної логіки; кириличні ключі лишаються підрядковими.

Chosen option (complexity): "COMPLEXITY_KEYS → L2", because безпечніше over- ніж under-класифікувати; лише COMPLEXITY_KEYS (не всі L2_KEYS) перекривають L0, щоб `rename feature` залишався L0.

### Consequences

- Good, because `'add prefix validation'` більше не класифікується як L0; `'fix typo'` залишається L0.
- Good, because `'fix mdc checker'` отримує L2 — spec-крок не пропускається.
- Bad, because COMPLEXITY_KEYS (`mdc`, `rego`) — короткі підрядки, можуть давати хибний L2 у коротких описах. Залишено by-design.
- Neutral, because кириличні L0-ключі лишаються підрядковими — стемінг не реалізований.

## More Information

Файли: `npm/scripts/dispatcher/lib/level.mjs` (константи `L0_WORD_KEYS`, `L0_SUBSTR_KEYS`, `COMPLEXITY_KEYS`), `npm/scripts/dispatcher/lib/tests/level.test.mjs` (17 тестів green). Гілка `flow-level-l0-word-boundary` (`b8fe7df`) → `main`.
