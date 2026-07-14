---
type: Rust Module
title: local_cloud.rs
resource: llm-lib/crates/llm-cascade/src/local_cloud.rs
docgen:
  crc: f7182490
---

## Огляд

One-shot виклики чату через genai для локальних і хмарних тирів. Локальні тири — кастомний OpenAI-сумісний ендпоінт (наприклад omlx); хмарні — стандартна автентифікація genai за env-змінними провайдера. Без retry: один HTTP-виклик на звернення — той самий fail-fast принцип, що й у `runOneShot` з `@7n/llm-lib`.

## Поведінка

`LocalCloud::one_shot(tier, system, user)` резолвить абстрактний тир у `"provider/model-id"` через `resolve_model`. Якщо `provider` є серед налаштованих `local_providers` — запит іде на кастомний локальний ендпоінт; будь-який інший префікс трактується як відомий genai хмарний провайдер, і модель передається без префіксу (genai сам розпізнає адаптер за іменем моделі та бере власний дефолтний ендпоінт/env-ключ).

Помилки: `NoModelConfigured` — для тиру не задано жодної env-змінної; `Provider` — помилка виклику або порожня відповідь моделі.

## Публічний API

- `LocalProvider { base_url, api_key }` — конфіг одного локального OpenAI-сумісного провайдера. `base_url` має закінчуватися слешем (наприклад `http://127.0.0.1:8000/v1/`) — інакше URL-join з'їдає останній сегмент шляху. `api_key: None` — на ендпоінт піде заглушка-плейсхолдер; `Some(key)` — для серверів, що звіряють `Authorization: Bearer`.
- `LocalCloud::new(local_providers)` — клієнт із мапою `provider-префікс → LocalProvider`.
- `LocalCloud::one_shot(tier, system, user) -> Result<String, CascadeError>` — один виклик чату з опційним system-повідомленням.

## Гарантії поведінки

- Рівно один HTTP-виклик на `one_shot`; повторів немає.
- Порожня відповідь моделі — це `Err(Provider)`, а не порожній `Ok`.
