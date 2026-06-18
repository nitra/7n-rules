---
type: ADR
title: "Flow-стан як sibling-файл та `flow init` як ідемпотентна надмножина"
---

# Flow-стан як sibling-файл та `flow init` як ідемпотентна надмножина

**Status:** Accepted
**Date:** 2026-06-02

## Context and Problem Statement
`flow review`, `flow verify`, `flow release` потребують `base_commit` та метаданих задачі (`level`, `risk`, `plan`, `status`). Постало питання: де зберігати цей стан відносно git-worktree — всередині директорії чи поряд із нею. Додатково: worktree може бути створений через `flow init` або напряму через `n-cursor worktree add`; у другому випадку `.flow.json` відсутній і турнікет не має що читати.

## Considered Options
- Файл всередині worktree-директорії
- Sibling-файл `.worktrees/<branch>.flow.json` поряд із директорією worktree
- `flow init` з перевіркою `isLinkedWorktree(cwd)` для ідемпотентного recovery (запис стану без повторної ізоляції)

## Decision Outcome
Chosen option: "sibling-файл + `flow init` = `worktree add` + `writeState()`", because sibling-файл видимий інструментам ззовні worktree-директорії (зокрема `flow review` читає `statePath` через `state-store.mjs`) і не забруднює git-індекс worktree; guard `isLinkedWorktree(cwd)` дозволяє recovery без повторної ізоляції.

### Consequences
- Good, because `readState(statePath)` у `review.mjs:116–121` знаходить стан за стандартною конвенцією без потреби заходити всередину worktree-директорії.
- Good, because transcript підтверджує успішний recovery: запуск `flow init` з існуючого worktree → `flow: уже в worktree — не вкладаю новий; init: … → .flow.json`.
- Bad, because worktree, створений через `worktree add` або `git worktree add` без `flow init`, залишається сліпою плямою для турнікета — `flow review` поверне exit 1 із повідомленням про відсутній стан.

## More Information
- `npm/scripts/dispatcher/lib/state-store.mjs:4–7` — конвенція: директорія `.worktrees/feat-x` → стан `.worktrees/feat-x.flow.json`.
- `npm/scripts/dispatcher/lib/commands.mjs:76–77` — guard `if (isLinkedWorktree(cwd))`: пропуск `worktree add`.
- `npm/scripts/dispatcher/lib/commands.mjs:99–117` — два кроки `init`: `ensureWorktree` + `writeState`.
- `npm/scripts/dispatcher/lib/review.mjs:116–121` — `readState(statePath)`: якщо `null`, exit 1.
