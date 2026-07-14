---
type: ADR
title: omlx wire-trace через єдиний wrapper у callOmlx
description: Прямі omlx-виклики інструментуються в одному транспортному чокпойнті з raw gitignored trace, агрегатом у git і fallback-ланцюжком для reasoning.
---

**Status:** Accepted
**Date:** 2026-06-10

## Context and Problem Statement

Проєкт перейшов на більшу кількість прямих HTTP-викликів до локального omlx-сервера через `npm/lib/omlx.mjs:callOmlx`. Поточний транспорт повертає caller-ам лише текст відповіді, через що губляться `usage`, `finish_reason`, latency, retry-count, помилки та thinking/reasoning-сигнали. Ці сліди потрібні для подальшого аналізу якості скілів і правил без дублювання логіки в кожному caller-і.

## Considered Options

- Єдиний wrapper навколо curl-блоку в `npm/lib/omlx.mjs:callOmlx`.
- Інструментувати кожен caller окремо (`docgen-gen.mjs`, `llm-worker.mjs` тощо).
- Двошарова модель зберігання: сирий append-log gitignored + дистильований агрегат у git.
- Сирий лог у git.
- Multi-source fallback для reasoning: `reasoning_content` → `<think>` regex → `truncated` при `finish_reason: "length"`.
- Лише `reasoning_content`.

## Decision Outcome

Chosen option: "Єдиний wrapper у `callOmlx` з raw gitignored trace, агрегатом у git і multi-source reasoning fallback", because transcript фіксує `callOmlx` як єдиний чокпойнт прямого omlx-трафіку, raw trace не можна комітити через розмір і вихідний код у `messages`, а живі тести показали різні форми thinking-сигналу залежно від відповіді omlx.

### Consequences

- Good, because одне місце інструментування покриває `docgen-gen.mjs`, `llm-worker.mjs`, `docgen-batch-omlx.mjs` та інші callers без рознесення logging-коду по 10+ файлах.
- Good, because raw `.n-cursor/omlx-trace*.jsonl` може зберігати повні wire-records до агрегації, а дистильовані висновки зберігаються в git для history та code-review.
- Good, because `reasoning_source` дозволяє відрізняти структуроване reasoning від `<think>`-тегів і обрізаного thinking при `finish_reason: "length"`.
- Bad, because transcript не містить підтвердження негативних наслідків для єдиного wrapper або reasoning fallback; для raw trace зафіксовано лише обмеження, що сирі `messages` містять вихідний код і не мають потрапляти в git.
- Neutral, because kill-switch `N_CURSOR_OMLX_TRACE=0` зафіксований як режим вимкнення trace, але transcript не містить підтвердження окремих наслідків цього режиму.

## More Information

- Транспорт: `npm/lib/omlx.mjs`, функція `callOmlx`.
- Callers: `npm/skills/docgen/js/docgen-gen.mjs:callOmlxMessages`, `npm/skills/fix/js/llm-worker.mjs`, `npm/skills/docgen/js/docgen-batch-omlx.mjs`.
- Raw storage: `.n-cursor/omlx-trace.jsonl` і `.n-cursor/omlx-trace.<seq>.jsonl`, gitignored, append-only, з недеструктивною ротацією; стартовий поріг ротації — 50 MB.
- Aggregate storage: `docs/insights/omlx-aggregate/` у git.
- Орієнтовна схема запису: `{ ts, caller, model, url, temperature, max_tokens, messages, content, reasoning, reasoning_source, reasoning_truncated, finish_reason, usage, ms, attempts, ok, error }`; `messages` cap до 8k і sha256 зафіксовані в transcript.
- Reasoning extraction: primary `message.reasoning_content`; fallback regex для `<think>…</think>`; при `finish_reason: "length"` ставиться `reasoning_truncated: true`.
- Живий тест на `http://127.0.0.1:8000/v1/chat/completions` із моделлю `Qwen3-4B-Thinking-2507-4bit` підтвердив `reasoning_content`, `prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_tokens_details.cached_tokens`, `model_load_duration`, `total_time`.
- Режим: always-on, kill-switch `N_CURSOR_OMLX_TRACE=0`.
- Спека: `docs/specs/2026-06-10-omlx-wire-trace-capture-design.md`.
- Побічний факт transcript: у `~/.omlx/settings.json` вимкнено auth-перевірку (`skip_api_key_verification: true`) і виконано `omlx restart`; виклики без `Authorization`-хедера підтверджено.

## Update 2026-06-11

Wire-trace перенесено з вузького `callOmlx`-рівня на уніфікований `callLlm` checkpoint.

Рішення:

- Трасувати LLM-виклики в `npm/lib/llm.mjs` через `callLlm`, а не окремо в кожному caller-і.
- Зробити trace always-on із kill-switch `N_CURSOR_OMLX_TRACE=0` замість попереднього opt-in `N_CURSOR_LLM_TRACE`.
- Зберігати raw JSONL у `.n-cursor/llm-trace.jsonl`, gitignored, з недеструктивною ротацією.
- Залишити довгострокові агреговані знання для `docs/omlx-insights/` як окремий git-committed шар.
- Додати internal rich-return `callOmlxRaw`, а публічний `callOmlx` лишити сумісною string-обгорткою.

Причина: `callLlm` уже є єдиною точкою маршрутизації між локальним `omlx` і `pi`, тому instrumenting на цьому рівні покриває docgen/fix/coverage та обидва backend-и без розкидання trace-логіки по споживачах.

Наслідки:

- Good, because trace захоплює `reasoning_content`, `usage`, `finish_reason`, attempts і error-слід для `omlx`.
- Good, because `pi`-гілка теж проходить через той самий формат запису, навіть якщо structured reasoning/usage там відсутні.
- Bad, because transcript фіксує застереження: для `pi` reasoning і usage будуть `null`, а `.n-cursor/llm-trace.jsonl` постійно зростатиме й потребує ротації.

Факти з transcript:

- Новий модуль: `npm/lib/omlx-trace.mjs`.
- Точка інструментування: `npm/lib/llm.mjs`, функція `callLlm`.
- `npm/lib/omlx.mjs` отримав `callOmlxRaw` і `extractReasoning`.
- Raw trace path: `.n-cursor/llm-trace.jsonl`.
- Kill-switch: `N_CURSOR_OMLX_TRACE=0`.
- Жива перевірка: `Qwen3-4B-Thinking-2507-4bit` на `http://127.0.0.1:8000` повертає `message.reasoning_content`; при `finish_reason: "length"` reasoning може класифікуватися як `truncated`.
- Коміт: `7b7b5017`; transcript фіксує `74/74 tests pass`.
