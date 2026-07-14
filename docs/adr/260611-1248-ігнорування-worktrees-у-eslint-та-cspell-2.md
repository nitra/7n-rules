---
type: ADR
title: Ігнорування `.worktrees/**` у ESLint та CSpell
description: Кореневі git-worktree чекаути не мають потрапляти в lint і spellcheck, щоб не створювати false-positive помилки з копій репозиторію та handoff-файлів.
---

**Status:** Accepted
**Date:** 2026-06-11

## Context and Problem Statement

Під час `bun run lint-js` ESLint читав файли з кореневого каталогу `.worktrees/`, де лежать git-worktree чекаути та handoff-документи. Transcript фіксує конкретний випадок: `feat-coverage-changed-gate.handoff.md` дав 22 false-positive ESLint-помилки `no-undef`. Аналогічно CSpell міг перевіряти файли з `.worktrees/**`. У конфігурації вже був ігнор для `.claude/worktrees/**`, але не для кореневого `.worktrees/`.

## Considered Options

- Додати `.worktrees/**` до `ignores` у `eslint.config.js` та врахувати його для CSpell-скану.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `.worktrees/**` до ігнорів", because файли в `.worktrees/` є git-ігнорованими копіями репозиторію або handoff-документами, їхній lint не має продуктового сенсу й створює false-positive помилки, що блокують `lint-js`.

### Consequences

- Good, because `lint-js` після зміни завершився з `exit 0`, `0 errors`; лишилися тільки 49 передіснуючих warnings `sonarjs/cognitive-complexity`.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because `.claude/worktrees/**` вже був окремим ignore-path, а це рішення лише закриває кореневий `.worktrees/**`.

## More Information

- `eslint.config.js` — додано `'.worktrees/**'` до масиву `ignores`.
- `.cspell.json` — у transcript згадані зміни словника `ollama`/`Ollama`; окреме додавання `.worktrees/**` у `.cspell.json` transcript не підтверджує.
- Команда перевірки: `bun run lint-js`.
- Результат перевірки: `lint-js exit 0, 0 errors`, 49 warnings.
