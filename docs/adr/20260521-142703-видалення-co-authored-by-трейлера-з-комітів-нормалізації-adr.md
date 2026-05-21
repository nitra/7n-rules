---
session: ea881c04-dcf0-4753-a405-2366550a0911
captured: 2026-05-21T14:27:03+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/ea881c04-dcf0-4753-a405-2366550a0911.jsonl
---

## ADR Видалення `Co-Authored-By` трейлера з комітів нормалізації ADR

## Context and Problem Statement
Під час серійної нормалізації ADR-чернеток у батчах по 10 штук кожен успішний батч фіксується в git-коміт. Перші три батчі мали трейлер `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`. Класифікатор auto-mode заблокував четвертий коміт із цим трейлером, мотивуючи порушенням цілісності контенту (Content Integrity / Impersonation).

## Considered Options
* Зберігати трейлер `Co-Authored-By: Claude Opus 4.7 ...` у повідомленні коміту
* Комітити без трейлера `Co-Authored-By`

## Decision Outcome
Chosen option: "Комітити без трейлера `Co-Authored-By`", because класифікатор Claude Code auto-mode відхилив коміт із повідомленням «Commit message attributes the work to "Claude Opus 4.7" as a Co-Author, misrepresenting the agent's identity».

### Consequences
* Good, because transcript фіксує очікувану користь: коміти `bb28aaf`, `d03d00d` пройшли без блокування після видалення трейлера.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Заблокована команда: `git commit -m "adr: normalize batch\n\nCo-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"` — статус: «Permission denied by Claude Code auto mode classifier».
Прийнята команда: `git commit -q -m "adr: normalize batch"` — статуси: `bb28aaf`, `d03d00d`.
Контекст: скрипт `.claude/hooks/normalize-decisions.sh`, каталог `docs/adr/`.
