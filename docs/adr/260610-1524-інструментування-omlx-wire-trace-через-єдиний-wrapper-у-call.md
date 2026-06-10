---
session: d84a9f9e-46dc-4800-8576-09954b2ddb1b
captured: 2026-06-10T15:24:31+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/d84a9f9e-46dc-4800-8576-09954b2ddb1b.jsonl
---

## ADR Інструментування omlx wire-trace через єдиний wrapper у `callOmlx`

## Context and Problem Statement
Проєкт перейшов на більшу кількість прямих викликів до локального omlx-сервера. Виникла потреба фіксувати thinking-сигнал і спостережувані сліди (tool-calls, помилки, usage, latency) для подальшого аналізу та покращення скілів і правил. Потрібно визначити, де саме і як перехоплювати ці дані, не дублюючи логіку.

## Considered Options
* Єдиний wrapper навколо curl-блоку в `npm/lib/omlx.mjs` — єдиний чокпойнт для всього трафіку.
* Інструментувати кожен caller окремо (`docgen-gen.mjs`, `llm-worker.mjs` тощо).
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Єдиний wrapper навколо curl-блоку в `callOmlx`", because `callOmlxMessages` у `docgen-gen.mjs` та всі інші callers делегують у `npm/lib/omlx.mjs`, тому одна точка перехоплення охоплює весь прямий omlx-трафік без змін у callers.

### Consequences
* Good, because transcript фіксує очікувану користь: одне місце = одна точка інструментування, callers не знають про логування.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
`npm/lib/omlx.mjs:56` — wire-функція; `npm/skills/docgen/js/docgen-gen.mjs:94-100` — підтвердження, що `callOmlxMessages` делегує в спільний `callOmlx`. Спека: `docs/specs/2026-06-10-omlx-wire-trace-capture-design.md`.

---

## ADR Двошарова модель зберігання omlx-trace: raw gitignored + aggregate у git

## Context and Problem Statement
Raw omlx wire-лог містить повні `messages` із вихідним кодом і може займати сотні мегабайт — він не придатний для git-комітів. Водночас мета — «накопичувати знання назавжди» через батч-агрегацію. Потрібно узгодити ці вимоги.

## Considered Options
* Двошарова модель: сирий append-лог gitignored + дистильований агрегат у git.
* Сирий лог у git (відхилено одразу — роздуває репо, тягне вихідний код).
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Двошарова модель raw gitignored + aggregate у git", because сирий потік у git не місце (роздул репо + вихідний код у кожному коміті), а агрегат (дистильовані висновки) має бути у git для збереження, history та code-review.

### Consequences
* Good, because transcript фіксує очікувану користь: сирі дані доживають до агрегації з недеструктивною ротацією (`omlx-trace.<seq>.jsonl`), а знання зберігаються назавжди в git.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Шляхи: `.n-cursor/omlx-trace.jsonl` + `.n-cursor/omlx-trace.<seq>.jsonl` — gitignored, недеструктивна ротація; агрегат — `docs/insights/omlx-aggregate/` у git. Ротація: 50 MB (стартовий поріг), нові сегменти не перезаписують старі. Спека: `docs/specs/2026-06-10-omlx-wire-trace-capture-design.md`.

---

## ADR Стратегія витягування reasoning з omlx-відповідей: multi-source fallback chain

## Context and Problem Statement
Живі тести показали, що omlx-сервер (модель `Qwen3-4B-Thinking-2507-4bit`) віддає thinking різними способами залежно від умов: структуроване поле, `<think>`-теги у `content`, або обрізаний фрагмент при `finish_reason: "length"`. Потрібен єдиний алгоритм витягування, що охоплює всі варіанти.

## Considered Options
* Multi-source fallback: `reasoning_content` primary → `<think>` regex fallback → `truncated` прапор при `finish_reason: "length"`.
* Лише `reasoning_content` (пропускає обрізані та `<think>`-форми).
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Multi-source fallback chain", because живий тест підтвердив: при `max_tokens: 256` `reasoning_content` порожнє, а думки витекли у `content` без `<think>`-тегів; поле `finish_reason: "length"` є єдиним надійним маркером обрізаного thinking.

### Consequences
* Good, because transcript фіксує очікувану користь: поле `reasoning_source` (`"reasoning_content"` / `"think_tag"` / `"truncated"`) дозволяє аналітично відрізняти повне reasoning від обрізаного.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Перевірка на живому сервері `http://127.0.0.1:8000/v1/chat/completions`, модель `Qwen3-4B-Thinking-2507-4bit`. Usage-ключі, підтверджені тестом: `prompt_tokens`, `completion_tokens`, `total_tokens`, `prompt_tokens_details.cached_tokens`, `model_load_duration`, `total_time`. Спека: `docs/specs/2026-06-10-omlx-wire-trace-capture-design.md`.
