---
name: worktree
description: >-
  Створення та керування git-worktree через n-cursor worktree CLI: ізольований
  workspace у .worktrees/<branch>/ з інвентарним файлом-описом
---

# worktree — ізольований workspace через CLI

Для роботи в окремому git-worktree використовуй CLI `n-cursor worktree` — він
однаковий у Claude і Cursor, кладе worktree у `.worktrees/` (gitignored) і сам
створює інвентарний файл-опис поруч.

## Команди

- Створити (опис **обовʼязковий**):
  `npx @nitra/cursor worktree add <branch> "<навіщо цей worktree>"`
- Список активних з описами:
  `npx @nitra/cursor worktree list`
- Прибрати (гілку лишає; `--force` для брудного дерева):
  `npx @nitra/cursor worktree remove <branch> [--force]`
- Прибрати осиротілі описи / метадані:
  `npx @nitra/cursor worktree prune`

## Приклад

```bash
npx @nitra/cursor worktree add feat/skill-meta "реалізація Spec A: meta.json"
cd .worktrees/feat-skill-meta
# … робота в ізоляції …
cd -
npx @nitra/cursor worktree remove feat/skill-meta
```

Слеш у гілці перетворюється на дефіс для пласкої структури: `feat/skill-meta`
→ `.worktrees/feat-skill-meta/`. Git-гілка лишається `feat/skill-meta`.

Конвенція й заборони (де НЕ створювати worktree) — `.cursor/rules/n-worktree.mdc`.
