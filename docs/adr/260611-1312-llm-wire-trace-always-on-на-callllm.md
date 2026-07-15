---
type: ADR
title: "LLM wire-trace: always-on захоплення reasoning та слідів на callLlm"
description: Усі LLM-виклики трасуються в єдиній точці callLlm із записом reasoning, usage та observable-сліду в gitignored JSONL.
---

**Status:** Accepted
**Date:** 2026-06-11

## Context and Problem Statement

Проєкт має єдину точку LLM-викликів `npm/lib/llm.mjs` (`callLlm`), яка маршрутизує між локальним `omlx`-сервером і хмарним `pi` CLI. Попередній trace через `N_CURSOR_LLM_TRACE` був opt-in і фіксував лише поверхневі лічильники символів. Він не захоплював reasoning-канал (`reasoning_content`), повний `usage` і observable-слід на кшталт attempts, `finish_reason` та error.

Без цих даних transcript не дає змоги аналізувати, де правила або скіли недовизначені, які виклики дорогі та які завершуються проблемно.

## Considered Options

- Local-only wrapper тільки в `callOmlx`, який трасує лише `omlx`-бекенд.
- Окреме інструментування `pi`-шляху без єдиного чокпойнта.
- Уніфікований trace у `callLlm` як спільній точці для обох бекендів.

## Decision Outcome

Chosen option: "Уніфікований trace у `callLlm`", because `callLlm` уже є єдиною точкою маршрутизації між `omlx` і `pi`, тому trace у цьому місці покриває всі виклики без змін у споживачах і без розкидання логіки по скілах.

### Consequences

- Good, because усі виклики docgen/fix/coverage через обидва бекенди потрапляють у trace в одному форматі.
- Good, because для `omlx` захоплюються `reasoning_content`, `usage`, attempts і `finish_reason`.
- Bad, because `pi`-бекенд не повертає reasoning і usage у structured-формі, тому відповідні поля для нього будуть `null`.
- Neutral, because `.n-cursor/llm-trace.jsonl` зростатиме постійно; transcript фіксує недеструктивну ротацію 50 MB, але не містить підтверджених даних про реальний disk overhead.

## More Information

- Точка інструментування: `npm/lib/llm.mjs`, функція `callLlm`.
- Новий модуль: `npm/lib/omlx-trace.mjs`.
- Функції trace-модуля: `capMessages`, `buildTraceRecord`, `tracePath`, `rotateIfNeeded`, `writeTrace`.
- Internal rich-return: `npm/lib/omlx.mjs` → `callOmlxRaw` повертає `{content, reasoning, reasoningSource, finishReason, usage, attempts}`.
- Публічний API `callOmlx` лишається тонкою string-обгорткою.
- Raw-лог: `.n-cursor/llm-trace.jsonl`, gitignored.
- Kill-switch: `N_CURSOR_OMLX_TRACE=0`.
- Aggregate-знання плануються в `docs/omlx-insights/`.
- Жива перевірка: `Qwen3-4B-Thinking-2507-4bit` на `http://127.0.0.1:8000` повертає `message.reasoning_content` як окреме поле.
- При `finish_reason: "length"` thinking може зрізатися в `content`; trace позначає це як `reasoningSource: "truncated"`.
- Специфікація: `docs/specs/2026-06-10-omlx-wire-trace-capture-design.md`.
- Коміт після merge в main: `7b7b5017`; transcript фіксує 74/74 tests pass.

## Update 2026-06-11

Уточнено супровідні рішення для wire-trace:

- `callLlm` є єдиним чокпойнтом для trace обох бекендів — локального `omlx` і хмарного `pi`;
- `fix/llm-worker.mjs` і `coverage-classify/index.mjs` мігровані з прямих `callOmlx`/`pi`-spawn на `callLlm`;
- попередній opt-in trace через `N_CURSOR_LLM_TRACE` замінено на always-on JSONL-запис;
- kill-switch: `N_CURSOR_OMLX_TRACE=0`;
- сирий trace зберігається в `.n-cursor/llm-trace.jsonl` і gitignored, бо містить повні `messages`, вихідний код і reasoning;
- довгострокові знання мають дистилюватися в git-committed aggregate-шар `docs/omlx-insights/`;
- `callOmlxRaw` повертає rich-object з `content`, `reasoning`, `reasoningSource`, `finishReason`, `usage`, `attempts`, а `callOmlx` лишається string-wrapper для сумісності;
- `extractReasoning` деградує через `reasoning_content` → `<think>…</think>` у `content` → `truncated` для обрізаного thinking.
