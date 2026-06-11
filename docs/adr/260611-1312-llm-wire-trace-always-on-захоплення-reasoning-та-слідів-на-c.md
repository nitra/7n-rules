---
session: d84a9f9e-46dc-4800-8576-09954b2ddb1b
captured: 2026-06-11T13:12:47+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/d84a9f9e-46dc-4800-8576-09954b2ddb1b.jsonl
---

<message>
Task complete. main → 7b7b5017, 74/74 tests pass.
</message>
[assistant]
Замержено в main (`7b7b5017`), 74/74 тести зелені.

Wire-trace тепер always-on: кожен `callLlm`-виклик (docgen, fix, coverage — будь-який бекенд) пише JSONL-запис у `<cwd>/.n-cursor/llm-trace.jsonl` з reasoning (`reasoning_content` → `<think>` → truncated), повним `usage` і спостережуваним слідом.

---

## ADR llm wire-trace: always-on захоплення reasoning та слідів на callLlm

## Context and Problem Statement
Проєкт має єдину точку LLM-викликів `npm/lib/llm.mjs` (`callLlm`), яка маршрутизує між локальним omlx-сервером і хмарним `pi` CLI. Попередній механізм трасування (`N_CURSOR_LLM_TRACE`-opt-in) фіксував лише поверхневі лічильники символів і не захоплював ні reasoning-канал (`reasoning_content`), ні повний `usage` (токени, latency, cached), ні спостережуваний слід (attempts, finish_reason, error). Без цих даних неможливо аналізувати, де правила/скіли недовизначені та які виклики є найдорожчими або найпроблемнішими.

## Considered Options
* **A. Local-only** — wrapper тільки в `callOmlx`, трасує лише omlx-бекенд
* **B. + pi-шлях** — окремий wrapper і для pi-гілки, але без єдиного чокпойнта
* **C. Уніфікований** — спільний `callLlm` над обома бекендами як єдина точка трасування

## Decision Outcome
Chosen option: "C. Уніфікований", because `callLlm` (`npm/lib/llm.mjs`) вже існує як єдина точка маршрутизації між omlx і pi; трасувати там дає повне покриття обох бекендів в одному місці без розкидання по споживачах.

### Consequences
* Good, because transcript фіксує очікувану користь: усі виклики (docgen/fix/coverage, обидва бекенди) потрапляють у trace без змін у споживачах; `reasoning_content`, `usage` і слід (attempts, finish_reason) захоплені повно.
* Bad, because transcript не містить підтверджених негативних наслідків, але фіксує застереження: `pi`-бекенд не повертає reasoning і usage в structured-формі — там відповідні поля будуть `null`; обсяг файлу `.n-cursor/llm-trace.jsonl` зростатиме постійно (недеструктивна ротація 50 MB).

## More Information
- Точка інструментування: `npm/lib/llm.mjs` функція `callLlm`
- Новий модуль: `npm/lib/omlx-trace.mjs` (`capMessages`, `buildTraceRecord`, `tracePath`, `rotateIfNeeded`, `writeTrace`)
- Збагачений internal-return: `npm/lib/omlx.mjs` → `callOmlxRaw` (повертає `{content, reasoning, reasoningSource, finishReason, usage, attempts}`); `callOmlx` — тонка `string`-обгортка
- Raw-лог: `.n-cursor/llm-trace.jsonl` (gitignored, недеструктивна ротація `llm-trace.<seq>.jsonl`); kill-switch `N_CURSOR_OMLX_TRACE=0`
- Aggregate-знання: `docs/omlx-insights/` (коммітиться в git, заповнюється другою спекою)
- Жива перевірка reasoning: сервер `Qwen3-4B-Thinking-2507-4bit` на `http://127.0.0.1:8000` повертає `message.reasoning_content` як окреме поле; при `finish_reason: "length"` thinking зрізається в `content` → `reasoningSource: "truncated"`
- Специфікація: `docs/specs/2026-06-10-omlx-wire-trace-capture-design.md` (Approved 2026-06-10)
- Коміт: `7b7b5017`
