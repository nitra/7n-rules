---
session: 5b23f892-4c1f-41ed-b758-cd8977857998
captured: 2026-05-20T08:58:52+03:00
transcript: /Users/vitalii/.cursor/projects/Users-vitalii-www-nitra-cursor/agent-transcripts/5b23f892-4c1f-41ed-b758-cd8977857998/5b23f892-4c1f-41ed-b758-cd8977857998.jsonl
---

## ADR Підтримка подвійного формату JSONL у `capture-decisions.sh`

## Context and Problem Statement
Скрипт `capture-decisions.sh` не створював ADR-чернеток після сесій Cursor Agent, хоча хук справно спрацьовував (`fired` у логах). Причина — різний формат рядків у JSONL-файлах transcript: Claude Code записує `{"type":"user",...}`, а Cursor Agent — `{"role":"user",...}`. Фільтр `jq` перевіряв лише `.type`, тому для Cursor-transcript отримував 0 байт і мовчки виходив без виклику LLM.

## Considered Options
* Фільтрувати лише `.type` (лише Claude Code)
* Фільтрувати обидва поля `.type` і `.role` (Claude Code + Cursor Agent)

## Decision Outcome
Chosen option: "Фільтрувати обидва поля `.type` і `.role`", because transcript підтвердив, що Cursor Agent і Claude Code генерують JSONL із різними ключами, і підтримка обох усуває мовчазний збій без регресії для Claude Code.

### Consequences
* Good, because після виправлення capture успішно побудував transcript із Cursor-сесії і записав `docs/adr/20260520-085803-зворотний-звязок-зі-скілів-через-зворотний-канал-у-nitra-cur.md`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли: `npm/.claude-template/hooks/capture-decisions.sh` (канон) і `.claude/hooks/capture-decisions.sh` (проєктна копія). Додано логування `→ empty transcript after jq (Claude Code: .type; Cursor Agent: .role)` для діагностики майбутніх збоїв. Cursor Agent transcript знаходяться в `~/.cursor/projects/<project>/agent-transcripts/<session-id>/*.jsonl`; Claude Code — в `~/.claude/projects/<project>/<session-id>.jsonl`.
