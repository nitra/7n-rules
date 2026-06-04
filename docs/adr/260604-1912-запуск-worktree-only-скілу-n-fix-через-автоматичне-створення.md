---
session: 051b0f39-ae3c-4d7f-bd68-202f514a4851
captured: 2026-06-04T19:12:44+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/051b0f39-ae3c-4d7f-bd68-202f514a4851.jsonl
---

## ADR Запуск worktree-only скілу n-fix через автоматичне створення worktree

## Context and Problem Statement
Скіл `n-fix` позначений як `worktree: true` і може виконуватись виключно в окремому git-worktree (`.worktrees/<current-branch>-fix/`). Виклик `/n-fix` стався в основному дереві (`main` гілка, `/Users/vitaliytv/www/nitra/cursor`), тому preflight-перевірка зафіксувала невідповідність і вимагала ізоляції перед будь-якими змінами.

## Considered Options
* Автоматично створити worktree та продовжити виконання в ньому
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Автоматично створити worktree та продовжити виконання в ньому", because SKILL.md вимагає preflight: якщо `git rev-parse --show-toplevel` не вказує під `.worktrees/` — створити worktree командою `npx @nitra/cursor worktree add "<current-branch>-fix" "…"` без shell expansion і без запиту до користувача.

### Consequences
* Good, because `npx @nitra/cursor fix` завершився з `exit=0`, 0 помилок, 19 успішних перевірок — worktree-ізоляція не перешкодила виконанню.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Worktree створено: `.worktrees/main-fix` (гілка `main-fix`)
- Команда створення: `npx @nitra/cursor worktree add "main-fix" "n-fix: worktree-only skill"`
- Залежності встановлено: `bun install` (875 packages, 9.83s)
- Діагностика: `npx @nitra/cursor fix` — результат чистий, `git status --short` порожній
- Правило preflight описано в `.cursor/skills/n-fix/SKILL.md` і `CLAUDE.md` (`## Worktree-only skills`)
