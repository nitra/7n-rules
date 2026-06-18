---
type: ADR
title: "`flow init` як мінімальний старт для наявного worktree"
---

# `flow init` як мінімальний старт для наявного worktree

**Status:** Accepted
**Date:** 2026-06-05

## Context and Problem Statement

Worktree, створений через `n-cursor worktree add` (без `flow init`), не мав flow-стану, через що `flow review` падав із «стану нема». Потрібно було відновити стан без перестворення worktree зі втратою незакомічених змін.

## Considered Options

- `flow init` зсередини вже наявного worktree (виявлено через `isLinkedWorktree` → пропускає `worktree add`, лише дописує `.flow.json`)
- Видалити worktree й перестворити через `flow init` з нуля

## Decision Outcome

Chosen option: "`flow init` зсередини наявного worktree", because `ensureWorktree` в `commands.mjs:76-77` детектує `isLinkedWorktree(cwd)` і не вкладає новий worktree — натомість лише записує `.flow.json` поруч (`.worktrees/<branch>.flow.json`), зберігаючи незакомічену роботу.

### Consequences

- Good, because незакомічені зміни збережено, стан записано (`level 1, risk low`), `flow review` підхопив `.flow.json` і відпрацював із 11 findings.
- Bad, because transcript не містить підтвердження негативних наслідків.

## More Information

- `npm/scripts/dispatcher/lib/commands.mjs:76-90` — `ensureWorktree`, перевірка `isLinkedWorktree`
- `npm/scripts/dispatcher/lib/state-store.mjs:4-7` — стан як sibling-файл `.worktrees/<sanitized-branch>.flow.json`
- `npm/scripts/dispatcher/lib/review.mjs:116-121` — `readState` на старті `flow review`, exit 1 при відсутньому стані
- Команда відновлення: `cd .worktrees/feat-coverage-changed-gate && npx @nitra/cursor flow init feat/coverage-changed-gate "<опис>"`
