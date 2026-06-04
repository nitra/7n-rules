---
session: e635e4fb-4522-482e-a064-faef33d1941e
captured: 2026-06-04T10:28:59+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/e635e4fb-4522-482e-a064-faef33d1941e.jsonl
---

## ADR Додавання `.claude/scheduled_tasks.lock` до `.gitignore`

## Context and Problem Statement
У репозиторії існує файл `.claude/scheduled_tasks.lock`, що містить runtime-дані: `sessionId`, `pid`, `procStart`, `acquiredAt`. Постало питання, чи потрібно його виключати з git-tracking.

## Considered Options
* Додати `.claude/scheduled_tasks.lock` до `.gitignore`
* Залишити без змін (відстежувати або ігнорувати неявно)

## Decision Outcome
Chosen option: "Додати `.claude/scheduled_tasks.lock` до `.gitignore`", because у `.gitignore` вже присутній усталений патерн для runtime-артефактів `.claude/`: `.claude/hooks/*.log`, `.claude/hooks/.normalize-state`, `.claude/hooks/.normalize.lock`, `.claude/worktrees/`. Файл `.claude/scheduled_tasks.lock` містить виключно ephemeral runtime-дані (pid, sessionId, timestamp) і відповідає тому ж класу файлів.

### Consequences
* Good, because файл із pid/timestamp не потраплятиме до git history і не породжуватиме брудний стан робочого дерева між сесіями.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Вміст файлу на момент перевірки:
```json
{"sessionId":"4fcd6586-f372-4b12-9595-ba3be85a3b64","pid":52390,"procStart":"Wed Jun  3 12:20:33 2026","acquiredAt":1780491324104}
```
Наявні записи в `.gitignore` (рядки 6–9):
```
.claude/hooks/*.log
.claude/hooks/.normalize-state
.claude/hooks/.normalize.lock
.claude/worktrees/
```
Команди діагностики: `git check-ignore -v .claude/scheduled_tasks.lock`, `git ls-files .claude/`, `git status --short .claude/scheduled_tasks.lock`.
