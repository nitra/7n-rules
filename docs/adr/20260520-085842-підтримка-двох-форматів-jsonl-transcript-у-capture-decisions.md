---
session: 5b23f892-4c1f-41ed-b758-cd8977857998
captured: 2026-05-20T08:58:42+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/5b23f892-4c1f-41ed-b758-cd8977857998/5b23f892-4c1f-41ed-b758-cd8977857998.jsonl
---

## ADR Підтримка двох форматів JSONL-transcript у `capture-decisions.sh`

## Context and Problem Statement

`capture-decisions.sh` парсив transcript лише за полем `.type` (`{"type":"user",...}`), яке використовує Claude Code. Cursor Agent записує рядки у форматі `{"role":"user",...}`. Коли хук отримував Cursor-transcript, `jq`-фільтр повертав 0 байт, скрипт виходив мовчки без виклику LLM і без запису ADR.

## Considered Options

* Підтримувати обидва поля: `.type == "user"|"assistant"` (Claude Code) **та** `.role == "user"|"assistant"` (Cursor Agent) в одному `select`-вираженні
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Підтримувати обидва поля в одному `select`-вираженні", because transcript підтвердив: сесії Claude Code й Cursor Agent генерують різний JSONL, а одна умова `select` охоплює обидва випадки без гілки коду.

### Consequences

* Good, because transcript фіксує очікувану користь: після виправлення capture для сесії Cursor Agent (`5b23f892-…`) успішно записав `docs/adr/20260520-085803-зворотний-звязок-зі-скілів-через-зворотний-канал-у-nitra-cur.md`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Змінені файли:
- `npm/.claude-template/hooks/capture-decisions.sh` (канон)
- `.claude/hooks/capture-decisions.sh` (копія в проєкті)

Доданий `select`-вираз:
```jq
select(
.type == "user" or .type == "assistant"
or .role == "user" or .role == "assistant"
)
```

Також додано лог-рядок `empty transcript after jq (Claude Code: .type; Cursor Agent: .role)` для діагностики, якщо парсер знову поверне порожній результат.

Попередній успішний ADR о 08:40 (session `369795cd-…`) створювався з Claude Code transcript і тому проблеми не виявляв — баг проявлявся лише в Cursor Agent-сесіях.
