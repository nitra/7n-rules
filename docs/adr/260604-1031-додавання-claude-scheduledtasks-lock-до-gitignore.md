---
session: e635e4fb-4522-482e-a064-faef33d1941e
captured: 2026-06-04T10:31:40+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/e635e4fb-4522-482e-a064-faef33d1941e.jsonl
---

## ADR Додавання `.claude/scheduled_tasks.lock` до `.gitignore`

## Context and Problem Statement
Файл `.claude/scheduled_tasks.lock` містить runtime-дані (`sessionId`, `pid`, мітки часу), валідні лише на конкретній машині/в конкретному процесі. Файл не відстежувався git (`?? .claude/scheduled_tasks.lock`), але ризик випадкового коміту залишався. У репо вже існувала конвенція ігнорування аналогічних lock/state-файлів Claude.

## Considered Options
* Додати `.claude/scheduled_tasks.lock` до `.gitignore` — у канонічний snippet і локальний `.gitignore`
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Додати `.claude/scheduled_tasks.lock` до `.gitignore`", because файл містить суто машинно-локальний стан (`pid`, `sessionId`, `procStart`, `acquiredAt`), безглуздий і конфліктний для інших клонів, а в репо вже існує прецедент ігнорування `.claude/hooks/.normalize-state` та `.claude/hooks/.normalize.lock`.

### Consequences
* Good, because файл більше не потрапить до коміту випадково; `git check-ignore -v .claude/scheduled_tasks.lock` підтверджує правило `.gitignore:9`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Змінені файли:
- `.gitignore` — рядок `.claude/scheduled_tasks.lock` додано між `.normalize.lock` і `.claude/worktrees/`
- `npm/rules/adr/js/templates/hooks/.gitignore.snippet` — той самий рядок додано до канонічного шаблону, який `syncGitignoreAdrFragment` у `npm/scripts/sync-claude-config.mjs` merge-ить у `.gitignore` проєктів
- `npm/scripts/sync-claude-config.mjs` — doc-коментар оновлено, щоб відображав новий запис
- `npm/.changes/260604-1030.md` — change-файл `minor/Added` для наступного релізу `@nitra/cursor`
