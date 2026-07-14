---
type: ADR
title: Ігнорування `.worktrees/**` в ESLint та CSpell
description: Кореневі git-worktree checkout-и виключаються з lint-сканування, щоб не блокувати перевірки false-positive помилками з тимчасових копій репозиторію.
---

**Status:** Accepted
**Date:** 2026-06-11

## Context and Problem Statement

Під час `bun run lint-js` ESLint зчитував файли з кореневого каталогу `.worktrees/`, де лежать git-worktree checkout-и та handoff-документи. Зокрема `feat-coverage-changed-gate.handoff.md` породжував 22 false-positive ESLint-помилки `no-undef`. ESLint уже ігнорував `.claude/worktrees/**`, але не кореневий `.worktrees/**`.

CSpell також зачіпав повʼязані файли та вимагав словникових доповнень для термінів, що зʼявилися в поточній зміні.

## Considered Options

- Додати `.worktrees/**` до `ignores` у `eslint.config.js` і не лінтити git-worktree checkout-и.
- Додати потрібні слова до `.cspell.json`.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `.worktrees/**` до `ignores` у `eslint.config.js` і оновити словник CSpell", because файли в `.worktrees/` є git-ігнорованими копіями репозиторію та handoff-документами, які не мають блокувати lint основного checkout-а false-positive помилками.

### Consequences

- Good, because `lint-js` після зміни завершився з exit 0 і 0 errors; у transcript лишилися тільки 49 передіснуючих warnings `sonarjs/cognitive-complexity`.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because `.cspell.json` у цьому кроці також отримав слова `ollama` і `Ollama`, але transcript не фіксує окремого рішення про ширшу політику словника.

## More Information

- Змінений конфіг: `eslint.config.js` — додано `'.worktrees/**'` до `ignores`.
- `.claude/worktrees/**` уже був в ESLint-конфігу раніше.
- `.cspell.json` — додано `ollama` і `Ollama` до `words`.
- Команда перевірки: `bun run lint-js`.
- Результат: `lint-js exit 0, 0 errors`, 49 warnings.
- Transcript згадує передіснуючий lint-борг, який також був виправлений у цьому сеансі: regex-complexity у `docgen-gen.mjs`, `.sort()` → `.toSorted()` в `units-js.test.mjs`, винесення regex/fixtures у module scope у тестах doc-files.
