---
session: 5b23f892-4c1f-41ed-b758-cd8977857998
captured: 2026-05-20T09:02:18+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/5b23f892-4c1f-41ed-b758-cd8977857998/5b23f892-4c1f-41ed-b758-cd8977857998.jsonl
---

## ADR Підтримка двох форматів JSONL у `capture-decisions.sh`

## Context and Problem Statement
Хук `capture-decisions.sh` фільтрував рядки transcript через `select(.type == "user" or .type == "assistant")`. Cursor Agent пише JSONL з полем `.role`, а Claude Code — з `.type`, тому для Cursor-сесій transcript виходив порожнім і LLM не викликався — ADR не створювався.

## Considered Options
* Оновити jq-фільтр, щоб підтримував обидва поля: `.type` (Claude Code) і `.role` (Cursor Agent)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Оновити jq-фільтр для підтримки `.type` і `.role`", because після виправлення capture успішно прочитав Cursor-transcript і створив `docs/adr/20260520-085803-….md`.

### Consequences
* Good, because transcript фіксує очікувану користь: Cursor-сесії тепер генерують ADR-draft так само, як Claude Code-сесії.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `.claude/hooks/capture-decisions.sh` і `npm/.claude-template/hooks/capture-decisions.sh`. Доданий лог-рядок `→ empty transcript after jq (Claude Code: .type; Cursor Agent: .role)` для діагностики майбутніх відмов. Формати: `{"type":"user","message":{…}}` (Claude Code) vs `{"role":"user","message":{…}}` (Cursor Agent).

---

## ADR Зворотній канал зі скілів у споживацьких репо до `@nitra/cursor` через ефемерне резюме

## Context and Problem Statement
Після запуску скілів `n-lint`, `n-fix`, `n-llm-patch` у споживацьких репо накопичується сигнал — що в правилах незрозуміло, чого не вистачає в `check`, які кроки скіла зайві. Потрібен канал «назад у пакет» без прямого коміту з чужого репо.

## Considered Options
* **A.** `alwaysApply` правило `feedback.mdc` — агент після `n-*` скіла додає блок «Зворотний зв'язок» у відповідь
* **B.** Розширити `n-llm-patch` — скіл генерує промпт для окремої сесії в `@nitra/cursor`
* **C.** Stop-hook + `capture-decisions.sh` — після сесії LLM пише draft у `docs/adr/`

## Decision Outcome
Chosen option: "Комбінація B + C", because B забезпечує явний self-contained handoff, а C автоматично ловить архітектурні рішення з transcript без додаткових дій.

### Consequences
* Good, because transcript фіксує очікувану користь: один draft ADR у `docs/adr/` після завершення сесії; `n-llm-patch` покриває явний handoff.
* Bad, because якщо сесія не містить блоку `## ADR` у відповіді LLM — capture пропускає запис (зафіксований прецедент о 08:44).

## More Information
Варіант A відхилений через відсутність автоматичної версіонованості. Задіяні файли: `docs/adr/`, `.claude/hooks/capture-decisions.sh`, `.cursor/hooks.json`, `npm/skills/n-llm-patch/SKILL.md`.

---

## ADR Дедуплікація ADR-draft за ідентифікатором сесії

## Context and Problem Statement
Після виправлення парсера Cursor-transcript один stop-event може викликати `capture-decisions.sh` двічі для однієї `conversation_id` (зафіксовано о 08:50 і 08:52), що створює дублікати у `docs/adr/` і зайві LLM-виклики.

## Considered Options
* **1.** Перед записом перевіряти `docs/adr/*` на `session: <id>` у frontmatter і пропускати повторний запуск
* **2.** Lock-файл `.claude/hooks/.capture-<session>` на час виклику LLM
* **3.** Нічого не робити — normalize `merge-into` зведе дублі

## Decision Outcome
Chosen option: "Варіант 1 — перевірка `session:` у frontmatter", because мінімально простий підхід без додаткового стану; якщо draft уже існує, логувати `skip: session already captured` і не викликати LLM.

### Consequences
* Good, because transcript фіксує очікувану користь: менше дублікатів у `docs/adr/` і менше LLM-викликів на один stop.
* Bad, because якщо в одній сесії справді два різні ADR, другий не збережеться; обхід — ручний запуск capture.

## More Information
Задіяні файли: `.claude/hooks/capture-decisions.sh`, `docs/adr/*.md` (frontmatter-поле `session:`). Варіант 2 відхилений через потребу прибирати stale lock; варіант 3 — через зайвий шум до normalize.
