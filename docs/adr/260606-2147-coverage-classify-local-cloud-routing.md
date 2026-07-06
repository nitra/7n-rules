---
type: ADR
title: Coverage classify local-cloud routing
description: Класифікація survived mutants переходить з прямого Anthropic SDK на двотировий pi-routing LOCAL_MIN → CLOUD_MIN із fallback verdict.
---

**Status:** Accepted
**Date:** 2026-06-06

## Context and Problem Statement

`npm/scripts/coverage-classify/index.mjs` використовував Anthropic SDK напряму (`new Anthropic()`, `client.messages.create`) з хардкодованою моделлю `claude-sonnet-4-6` і перевіркою `ANTHROPIC_API_KEY`. Це суперечило глобальним тирам моделей із `npm/lib/models.mjs` і не давало можливості безкоштовної локальної класифікації простих мутантів.

## Considered Options

- Замінити SDK на `pi` з `CLOUD_MIN`.
- Двотировий routing: `LOCAL_MIN` → якщо fail → `CLOUD_MIN`.
- Залишити Sonnet, тільки перейти на `pi` transport.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Двотировий routing: LOCAL_MIN → якщо fail → CLOUD_MIN", because більшість мутантів прості, тому local модель може класифікувати їх безкоштовно; складні або невалідні відповіді ескалюються на cloud при невалідному JSON або Zod-помилці.

### Consequences

- Good, because прості мутанти класифікуються безкоштовно без `ANTHROPIC_API_KEY`.
- Good, because cache key містить `LOCAL_MIN+CLOUD_MIN` і автоматично інвалідується при зміні будь-якого тира.
- Good, because `opts.callPi` injection дає можливість тестувати без реального `pi` процесу.
- Bad, because якщо local модель поверне валідний JSON із неправильним вердиктом, ескалація не спрацює; threshold по confidence transcript не фіксує як реалізований.

## More Information

- Файли: `npm/scripts/coverage-classify/index.mjs`, `npm/scripts/coverage-classify/tests/index.test.mjs`.
- Routing: `callPi(prompt, LOCAL_MIN)` → `parseVerdict` через Zod → якщо throw, `callPi(prompt, CLOUD_MIN)` → якщо throw, `FALLBACK_VERDICT`.
- `FALLBACK_VERDICT`: `worth-testing`, `confidence=0`.
- Cache key: `` `${LOCAL_MIN}+${CLOUD_MIN}` ``.
- Тести з transcript: tier-1 success, tier-1 fail → tier-2, обидва fail, cache hit/miss, write.
- Commit: `a883b44d`.
