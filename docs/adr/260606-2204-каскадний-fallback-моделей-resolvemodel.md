---
type: ADR
title: "Каскадний fallback моделей через resolveModel"
description: Глобальні тири моделей вирішуються через єдиний helper resolveModel(tier) з прозорим fallback-каскадом.
---

**Status:** Accepted
**Date:** 2026-06-06

## Context and Problem Statement

Система мала шість глобальних змінних тирів моделей: `N_LOCAL_MIN_MODEL`, `N_LOCAL_AVG_MODEL`, `N_LOCAL_MAX_MODEL`, `N_CLOUD_MIN_MODEL`, `N_CLOUD_AVG_MODEL`, `N_CLOUD_MAX_MODEL`. Споживачі звертались до сирих констант напряму. Якщо локальна модель не налаштована або змінна порожня, виклики могли провалюватись без fallback-у до cloud-тиру.

## Considered Options

* Додати helper `resolveModel(tier)` у `npm/lib/models.mjs` із задокументованим каскадом fallback-ів та замінити прямі звернення у споживачах.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати helper `resolveModel(tier)` у `npm/lib/models.mjs` із задокументованим каскадом fallback-ів", because користувач сформулював точний каскад і вимагав зафіксувати його як контракт проєкту та реалізувати єдину точку вирішення моделі замість розкиданих прямих звернень до констант.

Каскад:

* `min` → `LOCAL_MIN` → `LOCAL_AVG` → `LOCAL_MAX` → `CLOUD_MIN`
* `avg` → `LOCAL_AVG` → `LOCAL_MAX` → `CLOUD_AVG`
* `max` → `LOCAL_MAX` → `CLOUD_MAX`

### Consequences

* Good, because система штатно відпрацьовує навіть без локальних моделей: `resolveModel('min')` повертає перший доступний тир аж до `CLOUD_MIN`.
* Good, because споживачі `coverage-classify`, `llm-worker`, `coverage-fix`, `subagent-runner` і `docgen-gen` отримують єдиний механізм вирішення моделі.
* Bad, because у `docgen-gen.mjs` `LOCAL_MIN` для ollama HTTP-виклику залишено напряму, щоб не передати cloud-ідентифікатор у ollama API; це виняток із загального правила.
* Neutral, because transcript не містить підтвердження поведінки, якщо весь каскад для тира порожній.

## More Information

Змінені файли:

* `npm/lib/models.mjs` — додано `resolveModel(tier)` та документацію каскаду.
* `npm/scripts/coverage-classify/index.mjs` — Tier 1: `LOCAL_MIN` замінено на `resolveModel('min')`; cache key оновлено.
* `npm/skills/fix/js/llm-worker.mjs` — `CLOUD_MIN` / `CLOUD_AVG` замінено на `resolveModel('min')` / `resolveModel('avg')`.
* `npm/scripts/coverage-fix.mjs` — `CLOUD_MAX` замінено на `resolveModel('max')`.
* `npm/scripts/dispatcher/lib/subagent-runner.mjs` — `CLOUD_AVG` замінено на `resolveModel('avg')`.
* `npm/skills/docgen/js/docgen-gen.mjs` — `CLOUD_AVG` замінено на `resolveModel('avg')`; `LOCAL_MIN` залишено для ollama HTTP.

Change-файл: `npm/.changes/260606-2204.md` з bump `minor` і section `Added`.
