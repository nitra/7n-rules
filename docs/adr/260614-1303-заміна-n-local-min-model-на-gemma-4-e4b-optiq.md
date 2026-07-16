---
type: ADR
title: Заміна N_LOCAL_MIN_MODEL на gemma-4-e4b-it-OptiQ-4bit
description: Локальну min-модель для resolveModel оновлено з gemma-4-e2b на більшу gemma-4-e4b-it-OptiQ-4bit.
---

**Status:** Accepted

**Date:** 2026-06-14

## Context and Problem Statement

`npx @nitra/cursor fix-doc-files` і скіли, що викликають `resolveModel('min')`, вибирають локальну модель каскадно через env-змінні. Раніше у `~/.zshenv` було виставлено `N_LOCAL_MIN_MODEL=omlx/gemma-4-e2b-it-4bit`. Користувач вирішив замінити її на більшу модель.

## Considered Options

- `omlx/gemma-4-e2b-it-4bit` — попередня менша модель.
- `omlx/gemma-4-e4b-it-OptiQ-4bit` — нова більша модель з OptiQ-квантизацією.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "omlx/gemma-4-e4b-it-OptiQ-4bit", because користувач явно попросив замінити `export N_LOCAL_MIN_MODEL` у `~/.zshenv` саме на цю модель.

### Consequences

- Good, because transcript фіксує очікувану користь: більша модель потенційно дає якіснішу docgen-генерацію.
- Bad, because попередня сесія фіксувала, що `gemma-4-e4b-it-OptiQ-4bit` потребує близько 13.07 GB і може перевищувати `memory_guard_custom_ceiling_gb: 12`; поточний transcript не містить підтвердження, що це обмеження знято.
- Neutral, because transcript не містить benchmark або фактичного порівняння якості між e2b і e4b моделями.

## More Information

Змінений локальний файл: `~/.zshenv`, рядок `export N_LOCAL_MIN_MODEL=omlx/gemma-4-e4b-it-OptiQ-4bit`.

Каскад розвʼязання моделі за transcript: `N_CURSOR_DOCGEN_MODEL` → `N_LOCAL_MIN_MODEL` → `N_LOCAL_AVG_MODEL` → `N_LOCAL_MAX_MODEL` → `N_CLOUD_MIN_MODEL` → hardcoded fallback `omlx/mlx-community--gemma-4-e2b-it-4bit`.

Повʼязані файли пакета:

- `npm/lib/models.mjs` — `resolveModel`, `LOCAL_MIN`, `LOCAL_AVG`, `LOCAL_MAX`, `N_CLOUD_MIN_MODEL`.
- `npm/rules/doc-files/js/docgen-gen.mjs` — docgen використовує `N_CURSOR_DOCGEN_MODEL ?? resolveModel('min') ?? omlx/${DEFAULT_OMLX_MODEL}`.
- `npm/lib/omlx.mjs` — `DEFAULT_OMLX_MODEL = 'mlx-community--gemma-4-e2b-it-4bit'`.
- `npm/rules/doc-files/js/docgen-files-batch.mjs` — omlx health-check перед масовим прогоном.
