---
type: ADR
title: Уніфікований `callLlm` як точка wire-trace
description: Вирішено трасувати всі LLM-виклики на рівні `callLlm`, щоб one-shot, fix і coverage шляхи мали єдиний always-on JSONL-слід.
---

**Status:** Accepted
**Date:** 2026-06-11

## Context and Problem Statement

Проєкт має кілька LLM-шляхів: прямий HTTP до локального `omlx`-сервера через `callOmlx` і хмарний `pi` CLI. Виклики були розкидані по `docgen-gen.mjs`, `llm-worker.mjs`, `coverage-classify/index.mjs`, а попередній opt-in trace через `N_CURSOR_LLM_TRACE` фіксував лише поверхневі лічильники й не захоплював reasoning, повний `usage`, `finish_reason`, retries та error-слід. Потрібна єдина точка, де можна стабільно збирати wire-trace для аналізу якості скілів і вартості викликів.

## Considered Options

- Local-only wrapper лише навколо `callOmlx`.
- Окремо інструментувати `pi`-гілки в кожному скілі.
- Уніфікований `callLlm` як спільна функція над обома бекендами.
- Opt-in trace через env `N_CURSOR_LLM_TRACE=<file>`.
- Always-on trace з kill-switch.
- Змінити контракт `callOmlx` на rich-object.
- Додати internal `callOmlxRaw`, а `callOmlx` лишити string-обгорткою.

## Decision Outcome

Chosen option: "Уніфікований `callLlm` з always-on trace і internal `callOmlxRaw`", because `npm/lib/llm.mjs` уже був єдиною точкою маршрутизації між `omlx` і `pi`; трасування там покриває обидва бекенди без дублювання в caller-ах, а `callOmlxRaw` дає доступ до reasoning/usage без ламання публічного контракту `callOmlx -> string`.

### Consequences

- Good, because усі LLM-виклики через docgen/fix/coverage потрапляють у єдиний JSONL trace незалежно від бекенда.
- Good, because локальний `omlx` trace захоплює `reasoning_content`, `usage`, `finish_reason`, attempts і sha256-поля.
- Bad, because `pi`-бекенд не повертає reasoning і usage у structured-формі, тому відповідні поля там будуть `null`.
- Neutral, because raw trace містить чутливі повідомлення та код, тому він зберігається в gitignored `.n-cursor/`, а довгострокові знання мають дистилюватися в git-committed aggregate.

## More Information

- Точка інструментування: `npm/lib/llm.mjs`, функція `callLlm`.
- Новий trace-модуль: `npm/lib/omlx-trace.mjs`.
- Rich-return: `npm/lib/omlx.mjs` експортує `callOmlxRaw` і `extractReasoning`; `callOmlx` лишається string-wrapper.
- Raw-лог: `.n-cursor/llm-trace.jsonl`, gitignored, з недеструктивною ротацією `llm-trace.<seq>.jsonl`.
- Kill-switch: `N_CURSOR_OMLX_TRACE=0`.
- Попередній `N_CURSOR_LLM_TRACE` opt-in trace замінено always-on записом.
- Aggregate-знання плануються в `docs/omlx-insights/`.
- Специфікація: `docs/specs/2026-06-10-omlx-wire-trace-capture-design.md`.
- Жива перевірка: `Qwen3-4B-Thinking-2507-4bit` на `http://127.0.0.1:8000` повертає `message.reasoning_content`; при `finish_reason: "length"` thinking може бути зрізаний у `content` і позначається як `reasoningSource: "truncated"`.

## Update 2026-06-11

Рішення реалізовано й замержено в `main` комітом `7b7b5017`; перевірка завершилась успішно: 74/74 tests pass.

Підсумковий стан: кожен `callLlm`-виклик пише JSONL-запис у `<cwd>/.n-cursor/llm-trace.jsonl` з reasoning (`reasoning_content` → `<think>` → `truncated`), повним `usage` для підтримуваних бекендів і спостережуваним слідом (`attempts`, `finish_reason`, error/ok).
