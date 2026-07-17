---
type: ADR
title: Opportunistic LLM-fix tier для lint-правил
description: Lint-правила з LLM-виправленнями мають отримати окремий opt-in tier замість неявної генерації в детекторі.
---

**Status:** Accepted
**Date:** 2026-06-15

## Context and Problem Statement

Doc-files lint-правило детектить застарілу документацію, але генерація потребує локальної LLM (`omlx`). Виникла ідея виконувати генерацію opportunistically у lint-циклі: якщо omlx доступний — генерувати scoped, якщо недоступний — показувати skip/warn і лишати exit 1. Під час обговорення це узагальнено як можливий патерн для lint-правил із LLM-fixable помилками.

## Considered Options

- Залишити lint-крок detect-only, а fix виконувати тільки через `fix-doc-files`.
- Opportunistic LLM-fix у `lint()`: omlx up → scoped generation, omlx down → warn + exit 1.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Opportunistic LLM-fix tier — реалізувати через окрему спеку та safety triage", because пряме додавання генерації в `lint()` без спеки зламало б герметичність юніт-тестів детектора й порушило інваріант, що lint є детермінованим і дешевим.

### Consequences

- Good, because зʼявляється уніфікована модель `detect → deterministic fix → LLM-fix якщо omlx up → skip/report` для правил, де LLM-виправлення безпечне.
- Good, because doc-files може стати референсною реалізацією нового tier.
- Bad, because потрібен рефакторинг тестів детектора на `{ readOnly: true }` або мок генерації.
- Bad, because потрібен per-rule прапор `llm-fixable` у `meta.json`, бо не всі lint-помилки безпечно правити LLM.
- Bad, because потрібно витягнути `runGenerationBatch` з `docgen-files-batch.mjs` як окремий експорт.
- Neutral, because transcript не містить підтвердження, що всі правила мають перейти на цей tier.

## More Information

- Спека: `docs/specs/2026-06-15-opportunistic-llm-fix-tier.md`.
- Реюзабельні частини: `preflightProblem()` і loop з abort-streak у `npm/rules/doc-files/js/docgen-files-batch.mjs`.
- Наявний прецедент LLM-fix tier: conformance-фаза `runConformance` у `npm/rules/lint/js/orchestrate.mjs`.
- Changeset для цієї фічі не включено у `npm/.changes/260615-0638.md`.
