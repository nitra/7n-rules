---
type: ADR
title: Ігнорування root `.worktrees/**` в ESLint
description: ESLint має ігнорувати кореневі git-worktree артефакти, щоб не лінтити копії репозиторію та handoff-файли.
---

**Status:** Accepted
**Date:** 2026-06-11

## Context and Problem Statement

Під час `bun run lint-js` ESLint зчитував файли з кореневого каталогу `.worktrees/`, де зберігаються git-worktree checkout-и та handoff-документи. Transcript фіксує, що файл `feat-coverage-changed-gate.handoff.md` давав 22 false-positive ESLint-помилки `no-undef`. Водночас `.claude/worktrees/**` уже був проігнорований, але root `.worktrees/**` — ні.

## Considered Options

- Додати `.worktrees/**` до `ignores` у `eslint.config.js`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `.worktrees/**` до `ignores` у `eslint.config.js`", because файли в `.worktrees/` є git-ігнорованими копіями репозиторію або handoff-документами, які не мають лінтитися як частина поточного робочого дерева й породжують false-positive помилки.

### Consequences

- Good, because `lint-js` після зміни завершився з `exit 0` і `0 errors`; transcript фіксує лише 49 передіснуючих warnings `sonarjs/cognitive-complexity`.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because transcript уточнює, що `.cspell.json` у цьому кроці не отримував окремий `.worktrees/**` ignore; до словника додано `ollama`/`Ollama` для іншої lint-проблеми.

## More Information

- Змінений файл: `eslint.config.js` — додано `'.worktrees/**'` до масиву `ignores`.
- `.claude/worktrees/**` уже був у конфігу до цього рішення.
- `.cspell.json` у transcript згадується через додавання слів `ollama`/`Ollama`, а не через окремий `.worktrees/**` ignore.
- Команда перевірки: `bun run lint-js`.
- Результат з transcript: `lint-js exit 0, 0 errors`, 49 warnings.
