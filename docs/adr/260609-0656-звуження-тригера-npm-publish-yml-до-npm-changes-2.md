---
type: ADR
title: "Звуження тригера npm-publish.yml до npm/.changes/**"
description: Workflow npm-publish.yml має запускатися лише на change-файли, бо саме вони є релізним сигналом для n-cursor release.
---

**Status:** Accepted
**Date:** 2026-06-09

## Context and Problem Statement

Workflow `.github/workflows/npm-publish.yml` спрацьовував на будь-який push у директорію `npm/**`, включно зі змінами документації, типів і конфігів. Без change-файлів у `npm/.changes/` команда `n-cursor release` не має релізного контенту для публікації.

## Considered Options

- Залишити `npm/**` як широкий trigger.
- Замінити trigger на `npm/.changes/**`.

## Decision Outcome

Chosen option: "Замінити trigger на `npm/.changes/**`", because релізний flow побудований навколо change-файлів у `npm/.changes/`, а без них `n-cursor release` не публікує нічого.

### Consequences

- Good, because CI не запускається на нерелізні зміни в `npm/types/`, `npm/policy/`, документації та інших файлах, що не впливають на версію пакету.
- Bad, because якщо change-файл потрапить у репозиторій без супутнього коду, workflow все одно спрацює; transcript зазначає цей ризик як малоймовірний через `check changelog` у CI.
- Neutral, because transcript не містить підтвердження інших наслідків.

## More Information

Змінені файли:

- `.github/workflows/npm-publish.yml` — `paths: - 'npm/**'` замінено на `paths: - 'npm/.changes/**'`.
- `.cursor/rules/n-npm-module.mdc` — оновлено канонічний snippet у розділі `## CI / .github/workflows/npm-publish.yml`.
- `npm/check-npm-module.mjs` — функція `checkNpmPublishWorkflow` перевіряє `paths.includes('npm/.changes/**')` замість `paths.includes('npm/**')` і використовує відповідне повідомлення помилки.

## Update 2026-06-09

Додатково зафіксовано, що trigger `npm/.changes/**` узгоджується з pre-commit hook, який блокує commit без change-файлу.

Зміни з драфта:

- `.cursor/rules/n-npm-module.mdc` — оновлено canonical snippet `on.push.paths`;
- `.github/workflows/npm-publish.yml` — `paths: - 'npm/**'` замінено на `paths: - 'npm/.changes/**'`;
- change-файл: `.changes/260609-0656.md` з bump `patch` і section `Changed`.
