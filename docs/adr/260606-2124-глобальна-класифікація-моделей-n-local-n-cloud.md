---
type: ADR
title: ""
---

## ADR: Глобальна класифікація моделей — `N_LOCAL_*` / `N_CLOUD_*`

**Status:** Accepted  
**Date:** 2026-06-06

## Context and Problem Statement

Скіли, що викликають LLM через `pi`, раніше мали власні env vars (`N_CURSOR_FIX_MODEL_HAIKU`, `N_CURSOR_FIX_MODEL_SONNET`). Це створювало два проблеми:

1. **Anthropic-специфічні назви** — у проєктах без anthropic-ключа виникала помилка `No API key found for anthropic`.
2. **Дублювання конфігу** — кожен новий скіл додавав свої env vars; користувач мав налаштовувати їх окремо для fix, docgen, taze тощо.

## Considered Options

- Залишити per-skill env vars, документувати значення для кожного провайдера
- Одна глобальна змінна `N_LLM_MODEL` для всього
- **Шість глобальних тирів** — локальні (LOCAL) і хмарні (CLOUD), три рівні кожен

Інші варіанти не надавали гнучкості при ескалації (дешева → дорога модель) та не враховували offline-сценарій.

## Decision Outcome

Прийнято **шість глобальних env vars** у `npm/lib/models.mjs`:

| Змінна | Рівень | Приклади значень |
|---|---|---|
| `N_LOCAL_MIN_MODEL` | Швидкий локальний | `ollama/gemma3:4b` |
| `N_LOCAL_AVG_MODEL` | Середній локальний | `ollama/gemma4:26b-moe` |
| `N_LOCAL_MAX_MODEL` | Максимальний локальний | `ollama/llama4-maverick` |
| `N_CLOUD_MIN_MODEL` | Мінімальний хмарний | `openai/gpt-5.4-mini`, `google/gemini-2.5-flash`, `anthropic/claude-haiku-4-5` |
| `N_CLOUD_AVG_MODEL` | Середній хмарний | `openai/gpt-5.4`, `google/gemini-2.5-pro`, `anthropic/claude-sonnet-4-6` |
| `N_CLOUD_MAX_MODEL` | Максимальний хмарний | `openai/gpt-5.5`, `anthropic/claude-opus-4-8` |

Формат значення: `provider/model-id` — рядок, що передається в `pi --model`.  
Порожнє значення (`''`) → `pi` використовує свій дефолтний провайдер.

Кожен скіл **посилається на потрібний тир**, а не оголошує власну назву:

```js
import { CLOUD_MIN, CLOUD_AVG } from '../../../lib/models.mjs'

export const MODEL = env.N_CURSOR_FIX_MODEL ?? CLOUD_MIN        // override → tier
export const MODEL_HEAVY = env.N_CURSOR_FIX_MODEL_HEAVY ?? CLOUD_AVG
```

Per-skill override (`N_CURSOR_FIX_MODEL`) залишається як power-user опція, але не є основним шляхом конфігурації.

### Consequences

- Позитив: одна точка конфігурації для всіх скілів; провайдер-нейтральні назви.
- Позитив: ескалація (MIN → AVG) описується кодом, а не env vars.
- Позитив: при помилці `No API key` підказка вказує на `N_CLOUD_MIN_MODEL`, а не на конкретний скіл.
- Негатив: користувач мусить знати формат `provider/model-id` pi.
- Нейтрально: значення `''` дає недетерміновану поведінку (залежить від `~/.pi` конфігу).

## More Information

- `npm/lib/models.mjs` — імплементація
- `npm/skills/fix/js/llm-worker.mjs` — перший скіл, що використовує тири
- Майбутні скіли (docgen, taze) посилатимуться на той самий модуль

## Update 2026-06-06

Transcript уточнює застосування глобальної класифікації моделей у `npm/lib/models.mjs`: модуль експортує `LOCAL_MIN`, `LOCAL_AVG`, `LOCAL_MAX`, `CLOUD_MIN`, `CLOUD_AVG`, `CLOUD_MAX` і читає відповідні env vars `N_LOCAL_MIN_MODEL` … `N_CLOUD_MAX_MODEL`. Формат значення — `provider/model-id`, наприклад `ollama/gemma3:4b` або `openai/gpt-5.4-mini`.

Для `npm/skills/fix/js/llm-worker.mjs` зафіксовано дефолти `MODEL = CLOUD_MIN` і `MODEL_HEAVY = CLOUD_AVG`; після двох невдач на одному правилі оркестратор переходить з `MODEL` на `MODEL_HEAVY`. При відсутньому ключі повідомлення має підказувати налаштувати відповідний tier env var.

## Update 2026-06-06

Додано єдину точку вирішення моделі `resolveModel(tier)` у `npm/lib/models.mjs`, щоб споживачі не зверталися напряму до сирих констант тирів і могли прозоро fallback-итись, якщо локальні моделі не налаштовані.

Каскад fallback-ів:

- `min` → `LOCAL_MIN` → `LOCAL_AVG` → `LOCAL_MAX` → `CLOUD_MIN`
- `avg` → `LOCAL_AVG` → `LOCAL_MAX` → `CLOUD_AVG`
- `max` → `LOCAL_MAX` → `CLOUD_MAX`

Оновлені споживачі з transcript:

- `npm/scripts/coverage-classify/index.mjs` — Tier 1 перейшов з `LOCAL_MIN` на `resolveModel('min')`; cache key оновлено.
- `npm/skills/fix/js/llm-worker.mjs` — `CLOUD_MIN`/`CLOUD_AVG` замінені на `resolveModel('min')`/`resolveModel('avg')`.
- `npm/scripts/coverage-fix.mjs` — `CLOUD_MAX` замінено на `resolveModel('max')`.
- `npm/scripts/dispatcher/lib/subagent-runner.mjs` — `CLOUD_AVG` замінено на `resolveModel('avg')`.
- `npm/skills/docgen/js/docgen-gen.mjs` — `CLOUD_AVG` замінено на `resolveModel('avg')`.

Виняток: у `docgen-gen.mjs` `LOCAL_MIN` для прямого ollama HTTP-виклику залишено без `resolveModel('min')`, щоб не передати cloud-ідентифікатор у ollama API.

Change-файл: `npm/.changes/260606-2204.md`.
