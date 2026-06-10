# flow init ідемпотентна та coverage --changed без перезапису COVERAGE.md

**Status:** Accepted
**Date:** 2026-06-02

## Context and Problem Statement

Worktree, створений через голий `worktree add`, не має `.flow.json` — команди `flow review`/`verify`/`release` відмовляють. Окремо: у режимі `--changed` часткові coverage-метрики не повинні перезаписувати повний `COVERAGE.md`, інакше наступний `flow verify` побачить хибні дані.

## Considered Options

- Вимагати видалення worktree та повторного `flow init` з нуля
- `flow init` ідемпотентний: виявити linked-worktree через `isLinkedWorktree(cwd)`, пропустити `worktree add`, записати лише `.flow.json`
- Записувати partial-звіт у COVERAGE.md (перезаписувати повний)
- `--changed` лише як gate через exit-код, COVERAGE.md не чіпати

## Decision Outcome

Chosen option: "ідемпотентний `flow init`", because перевірка `isLinkedWorktree(cwd)` (рядки 76–77 `commands.mjs`) пропускає `worktree add` і записує лише стан — без втрати незакомічених змін.

Chosen option (coverage --changed): "gate через exit-код без перезапису COVERAGE.md", because `runCoverageSteps` при `opts.changed === true` повертає `0` без запису файлу (рядки 262–266).

### Consequences

- Good, because `flow init` у worktree видає `уже в worktree — не вкладаю новий`; `flow review` знаходить стан і відпрацьовує.
- Good, because тест `'changed + провайдер з даними → exit 0, але COVERAGE.md НЕ перезаписується'` проходить.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

`npm/scripts/dispatcher/lib/commands.mjs` рядки 76–90, 99–117; `state-store.mjs`. Стан: `.worktrees/<branch>.flow.json` (sibling, не всередині worktree). Coverage gate: `npm/rules/test/coverage/coverage.mjs` рядки 262–266. CLI: `npx @nitra/cursor coverage --changed`. Суміжне рішення про `git diff <base>` scope: `20260601-220027-coverage-gate-scoped-changed-від-base-commit.md`.
