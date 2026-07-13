---
type: ADR
title: "Інструментування omlx wire-trace через єдиний wrapper у callOmlx"
description: Усі прямі omlx-виклики логуються в raw gitignored trace через єдиний wrapper `callOmlx`, а дистильовані агрегати зберігаються в git.
---

**Status:** Accepted

**Date:** 2026-06-10

## Context and Problem Statement

Проєкт використовує прямі HTTP-виклики до локального omlx-сервера через `npm/lib/omlx.mjs:callOmlx`. Поточна функція повертає лише текст відповіді, через що губляться `reasoning_content`, `<think>`-сигнали, `usage`, `finish_reason`, latency, retry-count і помилки. Ці дані потрібні для аналізу місць, де правила або скіли недовизначені, але raw лог містить вихідний код і не підходить для git-комітів.

## Considered Options

- Єдиний wrapper навколо curl-блоку в `npm/lib/omlx.mjs:callOmlx`.
- Інструментувати кожен caller окремо (`docgen-gen.mjs`, `llm-worker.mjs`, `docgen-batch-omlx.mjs`).
- Двошарова модель: сирий append-only trace gitignored, дистильований aggregate у git.
- Сирий лог у git.
- Multi-source fallback для reasoning: `reasoning_content` → `<think>` regex → `truncated` при `finish_reason: "length"`.
- Лише `reasoning_content`.

## Decision Outcome

Chosen option: "єдиний wrapper у `callOmlx` з raw gitignored trace, aggregate у git і multi-source reasoning fallback", because `callOmlx` є єдиним wire-чокпойнтом для прямого omlx-трафіку, callers уже делегують у нього, сирий потік містить код і має лишатись поза git, а живі тести показали різні форми reasoning-сигналу залежно від відповіді сервера.

### Consequences

- Good, because одне місце інструментування покриває весь прямий omlx-трафік без змін у 10+ caller-файлах.
- Good, because raw trace зберігає повні wire-records до агрегації, а дистильований aggregate можна комітити для history і code-review.
- Good, because поле `reasoning_source` дозволяє відрізняти reasoning із `reasoning_content`, `<think>`-тегів і обрізаного `finish_reason: "length"`.
- Bad, because raw trace містить вихідний код у `messages`, тому має бути gitignored і потребує недеструктивної ротації.
- Neutral, because transcript не містить підтверджених наслідків для pi/Anthropic провайдерів; scope рішення обмежений прямим omlx capture.

## More Information

- Wire-функція: `npm/lib/omlx.mjs:callOmlx`.
- Callers: `npm/skills/docgen/js/docgen-gen.mjs:callOmlxMessages`, `npm/skills/fix/js/llm-worker.mjs`, `npm/skills/docgen/js/docgen-batch-omlx.mjs`.
- Raw storage: `.n-cursor/omlx-trace.jsonl` і `.n-cursor/omlx-trace.<seq>.jsonl`, gitignored.
- Aggregate storage: `docs/insights/omlx-aggregate/`, у git.
- Початковий поріг ротації: 50 MB; ротація недеструктивна.
- Kill-switch: `N_CURSOR_OMLX_TRACE=0`.
- Схема запису з transcript: `{ ts, caller, model, url, temperature, max_tokens, messages (cap 8k + sha256), content, reasoning, reasoning_source, reasoning_truncated, finish_reason, usage, ms, attempts, ok, error }`.
- Підтверджені usage-ключі: `prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_tokens_details.cached_tokens`, `model_load_duration`, `total_time`.
- Живий сервер у transcript: `http://127.0.0.1:8000/v1/chat/completions`, модель `Qwen3-4B-Thinking-2507-4bit`.
- Спека: `docs/specs/2026-06-10-omlx-wire-trace-capture-design.md`.
- Побічний факт transcript: у `~/.omlx/settings.json` було вимкнено auth-перевірку (`skip_api_key_verification: true`) і виконано `omlx restart`; це не є частиною scope ADR.
