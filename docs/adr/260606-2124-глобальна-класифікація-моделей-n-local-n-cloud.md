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
