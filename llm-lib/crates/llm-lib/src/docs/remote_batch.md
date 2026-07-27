---
type: Rust Module
title: remote_batch.rs
resource: llm-lib/crates/llm-lib/src/remote_batch.rs
docgen:
  crc: aae0f230
  model: omlx/gemma-4-e4b-it-OptiQ-4bit
  score: 75
---

## Огляд

Тип 2b (batch) — справжній `/v1/batches` бекенд поверх litellm batch-adapter (`docs/specs/2026-07-27-batch-local-avg-real-batches.md`), поруч із клієнтською емуляцією в [`crate::batch`]. Той самий контракт `submit → progress → results`: [`submit`] дзеркалить сигнатуру [`crate::batch::submit`] (мінус `executor` — сервер сам виконує items), тож виклик-сайт (`crate::batch::dispatch`) не відрізняє бекенд.  Протокол: upload JSONL (`POST /v1/files`, `purpose=batch`) → `POST /v1/batches` (`endpoint: /v1/chat/completions`) → poll `GET /v1/batches/{id}` до термінального статусу → `GET /v1/files/{output_file_id}/content` (JSONL) → `BatchResult` за `custom_id`. Помилка ОДНОГО item-у (`error`-поле рядка виводу) не валить решту; помилка/скасування/expiry всього batch-у (валідація вхідного файлу впала до старту жодного item-у) мапиться в однакову помилку для кожного вхідного `custom_id` — виклик-сайт (batch-оркестратори скілів) класифікує помилки per-item незалежно від бекенда.

## Публічний API

- RemoteBatchConfig — Інтервал опитування (`GET .../batches/{id}`) і м'який ліміт часу очікування завершення batch-у. Дефолти — консервативний старт (KEDA cold-start литого GPU-пода може тривати десятки секунд, повний batch — хвилини); калібрування за експлуатаційним досвідом лишається відкритим питанням спеки.
- probe_cached — Кешована capability-проба — єдина точка входу для [`crate::batch::dispatch`].
- submit — Submit одного batch-у через справжній `/v1/batches` litellm-адаптера. `model` — bare model-id (без `provider/` префіксу — той самий, що litellm очікує в тілі `chat/completions`). Порожній `items` повертає порожній результат без жодного HTTP-виклику (той самий контракт, що й [`crate::batch::submit`] і що використовує `nativeBatchAvailable` проба з порожнім набором на боці JS).  # Errors [`LlmError::Provider`] на мережеву помилку чи невалідну відповідь адаптера (upload/create/poll/output-фаза). Помилка ОКРЕМОГО item-у (в JSONL-виводі) не потрапляє сюди — вона в `BatchResult::outcome`.

## Гарантії поведінки

- Власних операцій запису (ФС/БД) у файлі немає; виклики імпортованих модулів можуть писати.
- Містить локальні fail-safe гілки; інші помилки можуть поширюватися назовні.
- Деякі локальні fail-safe гілки повертають порожнє значення (напр. `null`) замість винятку.
- Кешує результати в межах одного прогону.
