---
type: ADR
title: Ігнорування `.worktrees/**` у ESLint та CSpell
description: Вирішено ігнорувати кореневі git-worktree артефакти в lint-конфігах, щоб прибрати false-positive помилки з технічних checkout-файлів.
---

**Status:** Accepted
**Date:** 2026-06-11

## Context and Problem Statement

Під час `bun run lint-js` ESLint читав файли з кореневого каталогу `.worktrees/`, де лежать git-worktree checkout-и та handoff-документи. Зокрема `feat-coverage-changed-gate.handoff.md` давав 22 false-positive `no-undef` помилки. У конфігу вже був ignore для `.claude/worktrees/**`, але не для кореневого `.worktrees/**`. Також у тому ж контексті CSpell мав не сканувати технічні worktree-артефакти.

## Considered Options

- Додати `.worktrees/**` до ignore-налаштувань ESLint і CSpell.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `.worktrees/**` до ignore-налаштувань ESLint і CSpell", because файли в `.worktrees/` є git-ігнорованими технічними checkout/handoff артефактами, лінтити які немає сенсу; вони породжували false-positive помилки та блокували `lint-js`.

### Consequences

- Good, because `lint-js` завершився з exit 0 і 0 errors після ігнорування `.worktrees/**`.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because залишилися 49 попередніх warnings `sonarjs/cognitive-complexity`, але вони не блокували lint.

## More Information

- `eslint.config.js` — додано `'.worktrees/**'` до `ignores`.
- `.claude/worktrees/**` уже був у конфігу раніше.
- `.cspell.json` — у цьому ж lint-кроці додано слова `ollama` / `Ollama`; transcript уточнює, що `.worktrees/` не сканується через ignore-механізм.
- Команда перевірки: `bun run lint-js`.
- Додаткові виправлення lint-боргу в transcript: спрощення regex у `docgen-gen.mjs`, `.sort()` → `.toSorted()`, винесення тестових regex/fixtures у module scope.
