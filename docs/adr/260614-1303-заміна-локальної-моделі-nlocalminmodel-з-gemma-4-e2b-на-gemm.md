---
session: 8bd801e6-c1ea-4e77-887f-47d0a8dd4c9c
captured: 2026-06-14T13:03:02+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/8bd801e6-c1ea-4e77-887f-47d0a8dd4c9c.jsonl
---

Now the ADR:

---

## ADR Заміна локальної моделі `N_LOCAL_MIN_MODEL` з `gemma-4-e2b` на `gemma-4-e4b-it-OptiQ-4bit`

## Context and Problem Statement

`npx @nitra/cursor fix-doc-files` (і всі скіли, що викликають `resolveModel('min')`) вибирає локальну модель каскадно: `N_CURSOR_DOCGEN_MODEL` → `N_LOCAL_MIN_MODEL` → `N_LOCAL_AVG_MODEL` → `N_LOCAL_MAX_MODEL` → `N_CLOUD_MIN_MODEL` → хардкод-fallback `omlx/mlx-community--gemma-4-e2b-it-4bit`. Раніше у `~/.zshenv` було виставлено `omlx/gemma-4-e2b-it-4bit`; користувач вирішив оновити модель до більшої.

## Considered Options

* `omlx/gemma-4-e2b-it-4bit` — попередня модель (менший розмір)
* `omlx/gemma-4-e4b-it-OptiQ-4bit` — нова модель (більший розмір, OptiQ-квантизація)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: `"omlx/gemma-4-e4b-it-OptiQ-4bit"`, because користувач явно попросив замінити саме на цю модель (`~/.zshenv`, рядок `export N_LOCAL_MIN_MODEL`).

### Consequences

* Good, because transcript фіксує очікувану користь: більша модель потенційно дає якіснішу docgen-генерацію.
* Bad, because попередня сесія зафіксувала, що `gemma-4-e4b-it-OptiQ-4bit` потребує ~13.07 GB і перевищує omlx memory ceiling (`memory_guard_custom_ceiling_gb: 12` у `~/.omlx/settings.json`); в поточному transcript підтвердження, що обмеження знято, відсутнє.

## More Information

* Змінений файл: `~/.zshenv`, рядок 4: `export N_LOCAL_MIN_MODEL=omlx/gemma-4-e4b-it-OptiQ-4bit`
* Каскад розв'язання моделі: `npm/lib/models.mjs` (`resolveModel`, `LOCAL_MIN`, `LOCAL_AVG`, `LOCAL_MAX`, `N_CLOUD_MIN_MODEL`)
* Docgen-резолв у `npm/rules/doc-files/js/docgen-gen.mjs`: `N_CURSOR_DOCGEN_MODEL ?? resolveModel('min') ?? omlx/${DEFAULT_OMLX_MODEL}`
* Хардкод-fallback: `npm/lib/omlx.mjs` (`DEFAULT_OMLX_MODEL = 'mlx-community--gemma-4-e2b-it-4bit'`)
* Memory ceiling: `~/.omlx/settings.json` → `memory_guard_custom_ceiling_gb`; omlx health-check запускається у `npm/rules/doc-files/js/docgen-files-batch.mjs` перед масовим прогоном
