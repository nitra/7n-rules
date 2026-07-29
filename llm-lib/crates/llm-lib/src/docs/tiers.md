---
type: Rust Module
title: tiers.rs
resource: llm-lib/crates/llm-lib/src/tiers.rs
docgen:
  crc: dcb73417
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  tier: local-min
  score: 100
  judgeModel: openai-codex/gpt-5.4-mini
---

## Огляд

Тир-конфіг моделей — Rust-порт `model-tiers.mjs` з `@7n/llm-lib`.  Єдина policy вибору моделі: caller задає стартову env-сходинку, а resolver переходить лише до сильніших моделей, спочатку local, потім cloud.

## Поведінка

Tier визначає загальний рівень потужності моделі: `Min`, `Avg` або `Max`.

ModelEnv задає початковий рівень вибору моделі, який визначає логіку подальшого пошуку, охоплюючи локальні та хмарні варіанти.

local_min, local_avg, local_max, cloud_min, cloud_avg, cloud_max отримують назви моделей з відповідних змінних середовища; відсутність змінної повертає `None`.

resolve_model_from обчислює фінальну модель, послідовно проходячи від стартового рівня, спочатку шукаючи локальні, а потім — хмарні відповідники, якщо попередній рівень не був знайдений.

resolve_model є обгорткою, яка використовує Tier для визначення стартової ModelEnv і застосовує логіку пошуку.

parse_model_spec розбиває рядок моделі на провайдера та ідентифікатор моделі за першим роздільником; повертає помилку, якщо рядок не містить роздільника або будь-яка частина порожня.

## Публічний API

- Tier — Абстрактний тир якості моделі.
- ModelEnv — Явна стартова сходинка універсальної model-policy.
- local_min — `N_LOCAL_MIN_MODEL` — швидкий локальний inference. Напр. `omlx/gemma-4-e4b-it-OptiQ-4bit`.
- local_avg — `N_LOCAL_AVG_MODEL` — середній локальний.
- local_max — `N_LOCAL_MAX_MODEL` — максимальний локальний.
- cloud_min — `N_CLOUD_MIN_MODEL` — мінімальний хмарний (потрібен ключ). Напр. `openai/gpt-5.4-mini`.
- cloud_avg — `N_CLOUD_AVG_MODEL` — середній хмарний.
- cloud_max — `N_CLOUD_MAX_MODEL` — максимальний хмарний.
- resolve_model_from — Резолвить модель від явної env-сходинки, пропускаючи слабші рівні:  - `LocalMin`: local min → local avg → local max → cloud min → cloud avg → cloud max; - `LocalAvg`: local avg → local max → cloud avg → cloud max; - `LocalMax`: local max → cloud max; - cloud-старти проходять лише відповідну й сильніші cloud-сходинки.
- resolve_model — Backward-compatible tier facade: кожен tier починається з відповідної local-сходинки.
- parse_model_spec — Розбирає `"provider/model-id"` на частини (перший `/` — роздільник, решта — частина model-id, бо в id самому можуть бути `/`).  # Errors Повертає `Err` якщо рядок не містить `/` чи будь-яка частина порожня.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
