# Додавання `.claude/scheduled_tasks.lock` до `.gitignore`

**Status:** Accepted
**Date:** 2026-06-04

## Context and Problem Statement

Файл `.claude/scheduled_tasks.lock` містить runtime-дані (`sessionId`, `pid`, `procStart`, `acquiredAt`), валідні лише на конкретній машині/процесі. Файл не відстежувався git (`?? .claude/scheduled_tasks.lock`), але ризик випадкового коміту залишався. У репозиторії вже існує конвенція ігнорування аналогічних lock/state-файлів: `.claude/hooks/*.log`, `.claude/hooks/.normalize-state`, `.claude/hooks/.normalize.lock`.

## Considered Options

* Додати `.claude/scheduled_tasks.lock` до `.gitignore` — у локальний файл і в канонічний snippet
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `.claude/scheduled_tasks.lock` до `.gitignore`", because файл містить суто машинно-локальний стан, безглуздий і конфліктний для інших клонів, а в репо вже існує прецедент ігнорування `.claude/hooks/.normalize-state` та `.claude/hooks/.normalize.lock`.

### Consequences

* Good, because файл із pid/timestamp не потраплятиме до git history і не породжуватиме брудний стан між сесіями.
* Good, because `git check-ignore -v .claude/scheduled_tasks.lock` підтверджує правило `.gitignore:9`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- `.gitignore` — рядок `.claude/scheduled_tasks.lock` між `.normalize.lock` і `.claude/worktrees/`.
- `npm/rules/adr/js/templates/hooks/.gitignore.snippet` — той самий рядок у канонічному шаблоні, що `syncGitignoreAdrFragment` merge-ить у проєктах-споживачах.
- `npm/scripts/sync-claude-config.mjs` — doc-коментар оновлено.
- `npm/.changes/260604-1030.md` — change-файл (minor/Added).
