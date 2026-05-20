---
session: 5b23f892-4c1f-41ed-b758-cd8977857998
captured: 2026-05-20T09:02:19+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/5b23f892-4c1f-41ed-b758-cd8977857998/5b23f892-4c1f-41ed-b758-cd8977857998.jsonl
---

## ADR Підтримка двох форматів JSONL у `capture-decisions.sh`

## Context and Problem Statement
`capture-decisions.sh` фільтрував рядки transcript лише за `.type == "user"|"assistant"`, що є форматом Claude Code. Cursor Agent записує transcript у форматі з `.role == "user"|"assistant"` замість `.type`. Через це після stop-hook Cursor JSONL давав 0 байт тексту, скрипт виходив мовчки, і жоден LLM-виклик та ADR-файл не створювався.

## Considered Options
* Підтримати обидва формати в `jq`-фільтрі: `.type` (Claude Code) і `.role` (Cursor Agent)
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Підтримати обидва формати в `jq`-фільтрі", because виправлення одного `select()`-виразу охоплює обидва рантайми без жодної додаткової інфраструктури; після правки capture для Cursor-сесії `5b23f892-…` успішно створив draft ADR.

### Consequences
* Good, because transcript фіксує очікувану користь: після виправлення з'явився `docs/adr/20260520-085803-зворотний-звязок-зі-скілів-через-зворотний-канал-у-nitra-cur.md` із session `5b23f892-…`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/.claude-template/hooks/capture-decisions.sh`, `.claude/hooks/capture-decisions.sh`.
Додано діагностичний лог `→ empty transcript after jq (Claude Code: .type; Cursor Agent: .role)` при порожньому результаті.
Cursor transcript: `/Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/5b23f892-4c1f-41ed-b758-cd8977857998/*.jsonl`.

---

## ADR Дедуплікація ADR-чернеток за `session:` у frontmatter

## Context and Problem Statement
Після виправлення парсера один stop-хук інколи дає два `fired`-рядки для тієї самої `conversation_id` (зафіксовано 08:50 і 08:52), що потенційно створює два однакових draft у `docs/adr/` і подвоює витрати на LLM.

## Considered Options
* Перед записом перевіряти `docs/adr/*` на наявність `session: <id>` у frontmatter і пропускати виклик (`skip: session already captured`)
* Lock-файл `.claude/hooks/.capture-<session>` на час LLM-виклику
* Нічого не робити — `normalize` зведе дублі через `merge-into`

## Decision Outcome
Chosen option: "Перевіряти `session:` у frontmatter перед записом", because це найпростіший підхід без стану: один grep по `docs/adr/` і вихід із логом `skip: session already captured`, без потреби прибирати stale lock-файли.

### Consequences
* Good, because transcript фіксує очікувану користь: менше дублікатів у `docs/adr/` і менше зайвих LLM-викликів на подвійний stop.
* Bad, because якщо в одній сесії справді два різні ADR-рішення — другий draft не збережеться; обхід — ручний виклик capture.

## More Information
Файли: `.claude/hooks/capture-decisions.sh`, `docs/adr/*.md` (frontmatter поле `session:`).
Рішення обговорювалося в діалозі, але реалізацію в transcript не зафіксовано — це запланований наступний крок.

---

## ADR Зворотний звязок зі скілів через комбінацію n-llm-patch і stop-hook

## Context and Problem Statement
Після запуску скілів (`n-lint`, `n-fix`, `n-llm-patch`) у споживацьких репо накопичується сигнал про прогалини в правилах `@nitra/cursor`, але прямого шляху передати його назад у пакет без ручного коміту з чужого репо не було.

## Considered Options
* **A.** `alwaysApply` правило `feedback.mdc` — агент додає блок «Зворотний зв'язок» у відповідь після скіла
* **B.** Розширити `n-llm-patch` — скіл генерує самодостатній промпт для сесії в `@nitra/cursor`
* **C.** Stop-hook + `capture-decisions.sh` — після сесії LLM пише draft у `docs/adr/`

## Decision Outcome
Chosen option: "Комбінація B + C", because скіл `n-llm-patch` забезпечує явний handoff із контекстом, а stop-hook незалежно від дисципліни людини ловить архітектурні рішення з transcript; `feedback.mdc` з `alwaysApply` — лише як опціональний UX-шар, якщо потрібен миттєвий зворотний зв'язок у чаті.

### Consequences
* Good, because transcript фіксує очікувану користь: один draft ADR у `docs/adr/YYYYMMDD-HHMMSS-<session>.md` після завершення агента без додаткових ручних дій.
* Bad, because сесії без явного `## ADR`-блоку у відповіді LLM не дають файлу — зафіксовано о 08:44 (`response missing '## ' header`).

## More Information
Файли: `npm/skills/n-llm-patch/SKILL.md`, `.claude/hooks/capture-decisions.sh`, `.cursor/hooks.json`.
Конфігурація stop-хуків: `.cursor/hooks.json`, таймаути 180s / 600s.
