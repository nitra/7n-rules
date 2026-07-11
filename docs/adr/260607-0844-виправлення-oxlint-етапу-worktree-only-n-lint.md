---
type: ADR
title: Виправлення oxlint-етапу в worktree-only skill /n-lint
description: Зафіксовано рішення закрити блокувальні oxlint-помилки окремим кроком і відкласти pre-existing ESLint-фазу.
---

**Status:** Accepted
**Date:** 2026-06-07

## Context and Problem Statement

Команда `/n-lint` мала 270 oxlint-помилок у 56 файлах у `npm/` та `benchmarks/`. Ці помилки блокували проходження `bun run lint`, тому ESLint-етап не запускався взагалі.

## Considered Options

- Виправити всі 270 oxlint-помилок і розблокувати `bun run lint`.
- Вимкнути правила у `.oxlintrc.json` для проблемних файлів.
- Зупинитися після oxlint і відкласти pre-existing ESLint-помилки.

## Decision Outcome

Chosen option: "Виправити 270 oxlint-помилок і зупинитися після oxlint-етапу", because oxlint-збій блокував весь `bun run lint`, а ESLint після цього виявив 602 pre-existing помилки у 177 файлах, які користувач вирішив винести в наступну сесію.

### Consequences

- Good, because oxlint-етап став чистим: 270 помилок зведено до 0.
- Good, because `bun run lint` більше не зупиняється до ESLint через oxlint.
- Bad, because ESLint-етап із pre-existing помилками залишився відкритим для наступної сесії.

## More Information

- Worktree: `/Users/vitaliytv/www/nitra/cursor/.worktrees/main-lint/`.
- Команда lint: `bun run lint` → `bun run lint-ga && bun run lint-js && ... && oxfmt .`.
- `lint-js`: `bunx oxlint --fix && bunx eslint --fix . && bunx jscpd . && bunx knip ...`.
- Найбільші групи ESLint-помилок після oxlint: `no-undef`, `n/no-process-exit`, `sonarjs/unused-import`, `jsdoc/escape-inline-tags`, `sonarjs/slow-regex`.
- Change-файл: `.changes/260607-0842.md`.
- Коміти: `26d559ca` та `8f93099a`.
- У `npm/scripts/tests/post-tool-use-fix.test.mjs` додано `eslint-disable-next-line unicorn/prefer-event-target` для `EventEmitter`, бо `node:events.once()` не приймає `EventTarget`.
