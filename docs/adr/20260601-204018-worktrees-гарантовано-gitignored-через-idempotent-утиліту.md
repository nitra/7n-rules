---
session: c984ee56-447e-46ac-9ece-9409fe55c979
captured: 2026-06-01T20:40:18+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/c984ee56-447e-46ac-9ece-9409fe55c979.jsonl
---

## ADR `.worktrees/` гарантовано gitignored через idempotent-утиліту

## Context and Problem Statement
Проєкт використовує git worktree-and-convention (`n-worktree.mdc`) для ізольованих workspace у `.worktrees/<name>/`. Виникло питання: чи запис `.worktrees/` у `.gitignore` додається CLI-інструментом автоматично, чи потребує ручного коміту.

## Considered Options
* Утримувати `.worktrees/` у `.gitignore` вручну (статичний запис у репозиторії)
* Автоматично додавати запис через `ensure-gitignore-entries.mjs` при кожному `n-cursor worktree add`

## Decision Outcome
Chosen option: "Автоматичне додавання через `ensure-gitignore-entries.mjs`", because у `npm/scripts/` наявний окремий idempotent append-only модуль `ensure-gitignore-entries.mjs`, що перевіряє присутність запису перед дописуванням, а `worktree-cli.mjs` оркеструє конвенцію `.worktrees/`.

### Consequences
* Good, because transcript фіксує очікувану користь: `.gitignore` залишається консистентним незалежно від того, чи запис уже існує — модуль idempotent і не дублює рядки.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- `.gitignore` рядок 10: `.worktrees/`, рядок 9: `.claude/worktrees/`
- `npm/scripts/utils/ensure-gitignore-entries.mjs` — idempotent append-only модуль; якщо `.gitignore` відсутній — створює його
- `npm/scripts/lib/worktree.mjs` — містить `buildDescription` та санітизацію шляхів під `.worktrees/`
- `npm/scripts/worktree-cli.mjs` — CLI-оркестратор `n-cursor worktree add <branch> "<опис>"`, виконує `git worktree add .worktrees/<sanit> -b <branch>`
- Конвенція зафіксована в `.cursor/rules/n-worktree.mdc` (рядок 10, 17)
