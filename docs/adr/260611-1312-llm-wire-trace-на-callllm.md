---
type: ADR
title: "LLM wire-trace на `callLlm`: always-on захоплення reasoning та слідів"
description: Усі LLM-виклики трасуються в єдиній точці `callLlm`, щоб зберігати reasoning, usage і спостережувані сліди незалежно від backend-а.
---

**Status:** Accepted
**Date:** 2026-06-11

## Context and Problem Statement

Проєкт має LLM-виклики через локальний `omlx` сервер і хмарний `pi` CLI. Попередній механізм trace через `N_CURSOR_LLM_TRACE` був opt-in і фіксував лише поверхневі лічильники, без `reasoning_content`, повного `usage`, `finish_reason`, retries/attempts і помилок. Виклики були розкидані по споживачах, тому без єдиного choke point було складно аналізувати якість prompt-ів, скілів і вартість або проблемність LLM-викликів.

## Considered Options

- Local-only wrapper тільки навколо `callOmlx`, що трасує лише локальний `omlx` backend.
- Додатково інструментувати `pi`-гілки у кожному скілі окремо.
- Уніфікований `callLlm` як спільна функція над backend-ами і єдина точка трасування.

## Decision Outcome

Chosen option: "Уніфікований `callLlm`", because `npm/lib/llm.mjs` вже існує як спільна точка маршрутизації між `omlx` і `pi`, а трасування в ній дає повне покриття без розкидання instrumentation по `docgen`, `fix`, `coverage` та інших споживачах.

### Consequences

- Good, because усі LLM-виклики потрапляють у trace в одному форматі незалежно від backend-а.
- Good, because для `omlx` захоплюються `reasoning_content`, `usage`, `finish_reason`, attempts і hash/metadata trace-запису.
- Good, because `callOmlxRaw` дає rich-return для trace, а публічний `callOmlx` лишається сумісним string-wrapper.
- Bad, because `pi` backend не повертає reasoning і usage у structured-формі; відповідні поля для нього будуть `null` або деградованими.
- Neutral, because `.n-cursor/llm-trace.jsonl` ростиме постійно, тому transcript фіксує потребу в недеструктивній ротації приблизно від 50 MB.

## More Information

- Точка інструментування: `npm/lib/llm.mjs`, функція `callLlm`.
- Новий модуль: `npm/lib/omlx-trace.mjs` з `capMessages`, `buildTraceRecord`, `tracePath`, `rotateIfNeeded`, `writeTrace`.
- Rich internal API: `npm/lib/omlx.mjs` → `callOmlxRaw`, `extractReasoning`; `callOmlx` лишається string-wrapper.
- Raw trace: `.n-cursor/llm-trace.jsonl`, gitignored, з недеструктивною ротацією `llm-trace.<seq>.jsonl`.
- Kill-switch: `N_CURSOR_OMLX_TRACE=0`.
- Aggregate-шар знань: `docs/omlx-insights/`, який має коммітитись у git окремою агрегацією.
- Reasoning fallback: `reasoning_content` → `<think>…</think>` у `content` → `truncated` при обрізанні thinking через `finish_reason: "length"`.
- Жива перевірка: `Qwen3-4B-Thinking-2507-4bit` на `http://127.0.0.1:8000` повертає `message.reasoning_content` як окреме поле; при `max_tokens: 256` thinking може потрапляти в `content` без тегів і класифікуватися як `truncated`.
- Специфікація: `docs/specs/2026-06-10-omlx-wire-trace-capture-design.md`.
- Коміт із transcript: `7b7b5017`, тести: 74/74 passed.

## Update 2026-06-11

- Перед фінальним рішенням уточнено provider scope: поточний `callOmlx` (`npm/lib/omlx.mjs`) є прямим HTTP-клієнтом лише до локального `omlx`/MLX-сервера на `localhost:8000`.
- Reasoning доступний у цьому шляху, бо локальний `omlx` повертає `reasoning_content` відкрито; OpenAI-compatible провайдери можуть мати іншу поведінку, включно із зашифрованим reasoning.
- Розглянуто потенційні backend-и: локальний `omlx`, Ollama / LM Studio / llama.cpp, Anthropic API напряму, OpenAI API, `pi cli`.
- Дефолт перед фінальним рішенням був `omlx-specific` trace з чистим інтерфейсом, але подальше рішення перейшло до уніфікованого `callLlm` як єдиного choke point.

## Update 2026-06-11

- Зафіксовано окремі підрішення реалізації wire-trace:
  - `callLlm` є єдиною точкою перехоплення для обох backend-ів: локального `omlx` і хмарного `pi` CLI.
  - Raw trace зберігається у gitignored `.n-cursor/llm-trace.jsonl`, а довгострокові агреговані знання мають коммітитись у `docs/omlx-insights/`.
  - Trace увімкнено always-on із kill-switch `N_CURSOR_OMLX_TRACE=0`; попередній opt-in `N_CURSOR_LLM_TRACE=<file>` замінено.
  - `callOmlxRaw` повертає rich-object для `callLlm`, а публічний `callOmlx` лишається string-wrapper для сумісності.
- `extractReasoning` реалізує fallback: `reasoning_content` → `<think>…</think>` у `content` → `truncated`, якщо `finish_reason=length` обрізає thinking.
