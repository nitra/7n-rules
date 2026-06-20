---
type: ADR
title: "Відокремлення oxfmt від lint-ланцюжка"
---

# Відокремлення oxfmt від lint-ланцюжка

**Status:** Accepted
**Date:** 2026-06-20

## Context and Problem Statement

`bun run lint` завершувався кроком `oxfmt .`, який форматує JS/TS/Vue/JSON файли (write-режим, `.oxfmtrc.json` із Prettier-подібними налаштуваннями). `n-cursor lint` — система для перевірки (linting), а не форматування; включати форматер у lint-ланцюжок семантично некоректно і мутує файли під час перевірки.

## Considered Options

* Залишити `oxfmt .` як standalone скрипт `"oxfmt": "oxfmt ."` (вже присутній у `package.json`), викликати вручну або в CI окремо
* Lefthook pre-commit хук
* Окремий npm-скрипт `"format"` у `package.json`

## Decision Outcome

Chosen option: "Залишити `oxfmt .` як standalone скрипт", because `"oxfmt": "oxfmt ."` вже існує в `package.json`; жоден новий механізм не потрібен — тільки видалити `oxfmt .` з рядка `"lint"`.

### Consequences

* Good, because transcript фіксує очікувану користь: lint-команда більше не мутує файли як побічний ефект; форматування залишається доступним через явний виклик `bun run oxfmt`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- `package.json:22` — `"oxfmt": "oxfmt ."` (лишається як standalone скрипт)
- `.oxfmtrc.json` — конфіг форматера: arrowParens, singleQuote, semi, printWidth 120 тощо
- `npm/rules/text/policy/oxfmtrc/target.json` — правило, що вимагає наявності `.oxfmtrc.json`; не пов'язане з запуском oxfmt
