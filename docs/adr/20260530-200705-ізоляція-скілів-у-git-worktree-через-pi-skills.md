---
session: 09dcb1bc-929b-4d88-90b0-c0611bed3d2f
captured: 2026-05-30T20:07:05+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/09dcb1bc-929b-4d88-90b0-c0611bed3d2f.jsonl
---

## ADR Ізоляція скілів у git worktree через `.pi/skills/`

## Context and Problem Statement
Проєкт використовує git worktrees для паралельної роботи над гілками. Виникло питання, чи можна запускати скіли `n-fix` і `n-lint` у межах worktree і який ефект це дає. Glob-пошук показав, що скіли вже присутні у кожному worktree під `.pi/skills/`.

## Considered Options
* Запускати скіли тільки з кореневого репозиторію (shared)
* Копіювати скіли у кожен worktree під `.pi/skills/` (ізольовано)

## Decision Outcome
Chosen option: "Копіювати скіли у кожен worktree під `.pi/skills/`", because glob-результат підтверджує фактичну присутність `.pi/skills/n-fix/SKILL.md` та `.pi/skills/n-lint/SKILL.md` у кожному worktree (`.claude/worktrees/fix/stryker-incremental/`, `.claude/worktrees/feat/n-coverage-fix/` тощо).

### Consequences
* Good, because кожен worktree має власну копію скілів — зміни скіла в одній гілці не впливають на інші активні worktrees.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Знайдені шляхи за glob `**/skills/{n-lint,n-fix}/SKILL.md`:
- `.claude/worktrees/fix/stryker-incremental/.pi/skills/n-fix/SKILL.md`
- `.claude/worktrees/fix/stryker-incremental/.pi/skills/n-lint/SKILL.md`
- `.claude/worktrees/feat/n-coverage-fix/.pi/skills/n-fix/SKILL.md`
- `.claude/worktrees/feat/n-coverage-fix/.pi/skills/n-lint/SKILL.md`

Директорія `.claude/worktrees/` позначена як захищена у `cursor/CLAUDE.md` — файли там не можна змінювати вручну. Transcript обривається до фінальної відповіді; повний ефект запуску скілів у worktree в ньому не зафіксований.
