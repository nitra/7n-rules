---
type: ADR
title: Opportunistic LLM-fix tier для lint-правил
description: Lint-правила з LLM-fixable помилками мають отримати опортуністичний LLM-fix tier через окрему спеку та safety-тріаж.
---

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

doc-files lint-правило може виявляти stale-документацію, але її виправлення потребує локальної LLM (`omlx`). Виникла ідея: якщо модель доступна — генерувати scoped fix, якщо недоступна — report-skip і не робити зелений exit. Під час обговорення це узагальнено до потенційного патерну для інших lint-правил із LLM-fixable помилками.

## Considered Options

- Залишити lint-крок detect-only, а fix виконувати лише через `fix-doc-files`.
- Додати opportunistic LLM-fix у `lint()`: omlx up → scoped generation, omlx down → warn + exit 1.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Opportunistic LLM-fix tier — реалізувати через окрему спеку та safety-тріаж", because пряме додавання генерації в `lint()` без спеки зламало б герметичність unit-тестів детектора та інваріант дешевого детермінованого lint; потрібні явні тести, мок генерації та per-rule позначення безпечності.

### Consequences

- Good, because зʼявляється уніфікована модель `detect → deterministic fix → LLM-fix if available → skip/report`.
- Good, because doc-files може стати референсною реалізацією для LLM-fixable правил.
- Bad, because потрібні рефакторинг тестів на `{ readOnly: true }`, мок генерації, per-rule прапор `llm-fixable` і окремий експорт `runGenerationBatch`.

## More Information

Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`. Реюзабельні елементи з transcript: `preflightProblem()` і loop з abort-streak у `npm/rules/doc-files/js/docgen-files-batch.mjs`. Наявний прецедент LLM-fix tier: conformance-фаза `runConformance` у `npm/rules/lint/js/orchestrate.mjs`, але лише для `--full`, а не per-file сканерів. Не всі lint-помилки безпечно виправляти LLM: transcript окремо згадує `eslint no-unused-vars` і `complexity` як ризикові для поведінки коду.

## Update 2026-06-15

Попередній аналіз уточнив роль `readOnly` для `doc-files`: guard потрібен правилам, які можуть писати файли, тоді як detect-only шлях `doc-files/js/lint.mjs` лише сканує stale-документацію, пише звіт у stderr і повертає ненульовий exit. Генерація документації через локальну LLM залишається дорожчою операцією, тому її не можна безумовно переносити в кожен lint-запуск.

Зафіксований поділ:

- lint-крок — дешевий detect/fail-fast;
- `fix-doc-files` — opt-in генерація через модель;
- `readOnly` не має що блокувати у detect-only гілці.
