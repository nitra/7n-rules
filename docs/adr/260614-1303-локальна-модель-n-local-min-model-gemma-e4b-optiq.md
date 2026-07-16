---
type: ADR
title: Локальна модель N_LOCAL_MIN_MODEL gemma-4-e4b-it-OptiQ-4bit
description: Для мінімального локального LLM-tier обрано більшу omlx-модель gemma-4-e4b-it-OptiQ-4bit замість gemma-4-e2b-it-4bit.
---

**Status:** Accepted
**Date:** 2026-06-14

## Context and Problem Statement

`npx @nitra/cursor fix-doc-files` і всі виклики, що проходять через `resolveModel('min')`, вибирають модель каскадом: `N_CURSOR_DOCGEN_MODEL` → `N_LOCAL_MIN_MODEL` → `N_LOCAL_AVG_MODEL` → `N_LOCAL_MAX_MODEL` → `N_CLOUD_MIN_MODEL` → hardcoded fallback `omlx/mlx-community--gemma-4-e2b-it-4bit`.

У `~/.zshenv` раніше було налаштовано `N_LOCAL_MIN_MODEL=omlx/gemma-4-e2b-it-4bit`. Користувач вирішив замінити мінімальну локальну модель на більшу `gemma-4-e4b-it-OptiQ-4bit`.

## Considered Options

* `omlx/gemma-4-e2b-it-4bit` — попередня менша модель.
* `omlx/gemma-4-e4b-it-OptiQ-4bit` — нова більша модель з OptiQ-квантизацією.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "omlx/gemma-4-e4b-it-OptiQ-4bit", because користувач явно попросив замінити `export N_LOCAL_MIN_MODEL` у `~/.zshenv` саме на цю модель.

### Consequences

* Good, because transcript фіксує очікувану користь: більша модель потенційно дає якіснішу docgen-генерацію.
* Bad, because попередня сесія зафіксувала, що `gemma-4-e4b-it-OptiQ-4bit` потребує близько 13.07 GB і перевищує omlx memory ceiling `memory_guard_custom_ceiling_gb: 12`; у поточному transcript немає підтвердження, що це обмеження знято.
* Neutral, because зміна стосується користувацького `~/.zshenv`, а не файлу репозиторію.

## More Information

Змінений файл поза репозиторієм: `~/.zshenv`, рядок `export N_LOCAL_MIN_MODEL=omlx/gemma-4-e4b-it-OptiQ-4bit`.

Каскад резолюції моделі: `npm/lib/models.mjs` (`resolveModel`, `LOCAL_MIN`, `LOCAL_AVG`, `LOCAL_MAX`, `N_CLOUD_MIN_MODEL`).

Docgen-резолюція: `npm/rules/doc-files/js/docgen-gen.mjs` використовує `N_CURSOR_DOCGEN_MODEL ?? resolveModel('min') ?? omlx/${DEFAULT_OMLX_MODEL}`.

Hardcoded fallback: `npm/lib/omlx.mjs`, `DEFAULT_OMLX_MODEL = 'mlx-community--gemma-4-e2b-it-4bit'`.

Memory ceiling: `~/.omlx/settings.json` → `memory_guard_custom_ceiling_gb`; omlx health-check запускається в `npm/rules/doc-files/js/docgen-files-batch.mjs` перед batch-прогоном.
