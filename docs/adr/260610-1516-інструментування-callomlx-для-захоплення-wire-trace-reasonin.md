---
session: d84a9f9e-46dc-4800-8576-09954b2ddb1b
captured: 2026-06-10T15:16:28+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/d84a9f9e-46dc-4800-8576-09954b2ddb1b.jsonl
---

## ADR Інструментування `callOmlx` для захоплення wire-trace (reasoning + сліди)

## Context and Problem Statement
У проєкті використовуються прямі виклики до локального omlx-сервера через `npm/lib/omlx.mjs`. Поточна функція `callOmlx` повертає лише `choices[0].message.content`, губячи `reasoning_content`, `usage`, latency, послідовність ретраїв та інші метрики — без яких неможливо зрозуміти, де правила/скіли недовизначені й чому модель «борсається».

## Considered Options
* Один wrapper навколо curl-блоку в `callOmlx` (єдиний чокпойнт)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Один wrapper навколо curl-блоку в `callOmlx`", because `callOmlx` у `npm/lib/omlx.mjs` — єдиний чокпойнт: `docgen-gen.mjs`, `llm-worker.mjs` та `docgen-batch-omlx.mjs` всі делегують туди; інструментування одного місця покриває весь omlx-трафік, а виклики нічого не знають про логування.

### Consequences
* Good, because transcript фіксує очікувану користь: один wrapper дає повний wire-record (`messages` з ролями, `reasoning_content`, `usage.model_load_duration` / `total_time` / `cached_tokens`, `ms`, `attempts`, `ok`, `error`) без змін у 10+ caller-файлах.
* Good, because живий тест підтвердив: `message.reasoning_content` реально приходить як окреме поле (на `Qwen3-4B-Thinking-2507-4bit`), `content` при цьому залишається чистим — тобто reasoning-канал не треба вирізати з тексту в штатному випадку.
* Bad, because при `finish_reason: length` (обрізаний контекст) thinking витікає в `content` без `reasoning_content` — необхідний fallback: `message.reasoning_content` → regex `<think>…</think>` → прапор `reasoning_truncated: true`.

## More Information
- Файл транспорту: `npm/lib/omlx.mjs`, функція `callOmlx` (рядок ~56).
- Callers: `npm/skills/docgen/js/docgen-gen.mjs` (`callOmlxMessages`, рядок ~100), `npm/skills/fix/js/llm-worker.mjs`, `npm/skills/docgen/js/docgen-batch-omlx.mjs`.
- Схема запису: `{ ts, caller, model, url, temperature, max_tokens, messages (cap 8k + sha256), content, reasoning, reasoning_source, reasoning_truncated, finish_reason, usage, ms, attempts, ok, error }`.
- Сховище: `.n-cursor/omlx-trace.jsonl` (gitignored, сирий потік) → батч-агрегат (комітиться в репо); ротація недеструктивна (нумеровані архіви), щоб сирий лог переживав до агрегації.
- Режим: always-on, kill-switch `N_CURSOR_OMLX_TRACE=0`.
- Побічна дія сесії: вимкнено auth-перевірку в `~/.omlx/settings.json` (`skip_api_key_verification: true`) і зроблено `omlx restart` — підтверджено, що виклики без `Authorization`-хедера проходять.
- Спека: `docs/specs/2026-06-10-omlx-wire-trace-capture-design.md`.
- Scope цього ADR — лише capture; детектор 9 сигналів + LLM-аналіз — окрема, друга спека.
