---
type: ADR
title: "LLM wire-trace: always-on захоплення reasoning та слідів на callLlm"
description: Усі LLM-виклики трасуються в єдиній точці `callLlm`, щоб накопичувати reasoning, usage і спостережувані сліди незалежно від backend.
---

**Status:** Accepted
**Date:** 2026-06-11

## Context and Problem Statement

Проєкт має єдину точку LLM-викликів `npm/lib/llm.mjs` (`callLlm`), яка маршрутизує між локальним `omlx`-сервером і хмарним `pi` CLI. Попередній механізм трасування `N_CURSOR_LLM_TRACE` був opt-in і фіксував лише поверхневі лічильники символів. Він не захоплював reasoning-канал (`reasoning_content`), повний `usage` (токени, latency, cached), attempts, `finish_reason` та помилки. Без цих даних неможливо аналізувати, де правила або скіли недовизначені та які виклики є найдорожчими або проблемними.

## Considered Options

- Local-only: wrapper тільки в `callOmlx`, який трасує лише `omlx` backend.
- `+ pi` шлях: окремо інструментувати `pi`-гілки, але без єдиного checkpoint.
- Уніфікований `callLlm`: спільна функція над обома backend як єдина точка трасування.

## Decision Outcome

Chosen option: "Уніфікований `callLlm`", because `callLlm` уже існує як єдина точка маршрутизації між `omlx` і `pi`; трасування там дає повне покриття обох backend в одному місці без розкидання змін по споживачах.

### Consequences

- Good, because усі виклики `docgen`, `fix`, `coverage` та інших споживачів через `callLlm` потрапляють у trace без змін у caller-коді.
- Good, because для `omlx` захоплюються `reasoning_content`, `usage`, attempts і `finish_reason`.
- Bad, because `pi` backend не повертає reasoning і usage у structured-формі; transcript фіксує, що відповідні поля для нього будуть `null`.
- Neutral, because `.n-cursor/llm-trace.jsonl` зростатиме постійно; transcript фіксує недеструктивну ротацію 50 MB як стартовий поріг.

## More Information

- Точка інструментування: `npm/lib/llm.mjs`, функція `callLlm`.
- Новий модуль: `npm/lib/omlx-trace.mjs` з `capMessages`, `buildTraceRecord`, `tracePath`, `rotateIfNeeded`, `writeTrace`.
- `npm/lib/omlx.mjs` отримує `callOmlxRaw`, який повертає `{content, reasoning, reasoningSource, finishReason, usage, attempts}`; `callOmlx` лишається string-wrapper.
- Raw-лог: `.n-cursor/llm-trace.jsonl`, gitignored, з недеструктивною ротацією `llm-trace.<seq>.jsonl`.
- Kill-switch: `N_CURSOR_OMLX_TRACE=0`.
- Aggregate-знання: `docs/omlx-insights/`, має комітитися в git і наповнюватися окремою специфікацією.
- Жива перевірка: сервер `Qwen3-4B-Thinking-2507-4bit` на `http://127.0.0.1:8000` повертає `message.reasoning_content`; при `finish_reason: "length"` thinking може зрізатися в `content`, що дає `reasoningSource: "truncated"`.
- Специфікація: `docs/specs/2026-06-10-omlx-wire-trace-capture-design.md`.
- Коміт після merge: `7b7b5017`; transcript фіксує 74/74 tests pass.

## Update 2026-06-11

- Рішення уточнює, що попередній opt-in trace через `N_CURSOR_LLM_TRACE=<file>` замінено на always-on JSONL trace із kill-switch `N_CURSOR_OMLX_TRACE=0`.
- Raw-шар зберігається у `<cwd>/.n-cursor/llm-trace.jsonl` і gitignored, because повні `messages` можуть містити вихідний код і чутливий контекст.
- Довгострокові знання мають жити в агрегованому git-committed шарі `docs/omlx-insights/`, while raw trace є scratch-джерелом для агрегації.
- `callOmlxRaw` введено як internal rich-return для `content`, `reasoning`, `reasoningSource`, `finishReason`, `usage`, `attempts`; публічний `callOmlx` лишається string-wrapper для сумісності.
- `extractReasoning` деградує через `reasoning_content` → `<think>…</think>` у `content` → `truncated`, якщо `finish_reason=length` обрізав thinking.

## Update 2026-06-12

- Основним сигналом для покращення правил і скілів обрано спостережувані сліди (`tool-calls`, `ok/err`, latency, retry, token cost), а не reasoning-текст моделі, бо reasoning у різних провайдерів недоступний, зашифрований або неструктурований.
- `callLlm` закріплено як єдиний choke-point для wire-trace над local omlx і cloud/pi backend; прямі caller-и мають передавати `opts.caller` для атрибуції.
- Зберігання trace має дворівневу модель: raw `.n-cursor/llm-trace.jsonl` лишається gitignored з недеструктивною ротацією, а агреговані висновки зберігаються в `docs/omlx-insights/` під git.
- Для reasoning з omlx використовується ієрархія джерел: `message.reasoning_content` → `<think>` tags → маркер `truncated` при `finish_reason === 'length'` → `none`.
- Transcript фіксує обмеження: pi-гілка дає деградований trace без structured `usage`/`reasoning`, бо `spawnSync('pi')` не повертає такі metadata.
