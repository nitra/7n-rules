---
type: ADR
title: "Звуження тригера npm-publish.yml до npm/.changes/**"
description: Workflow публікації npm має запускатися лише за появи change-файлів, бо саме вони є сигналом релізного контенту.
---

**Status:** Accepted

**Date:** 2026-06-09

## Context and Problem Statement

Workflow `.github/workflows/npm-publish.yml` спрацьовував на будь-який push у директорію `npm/**`, включно зі змінами документації, типів, конфігів та інших файлів, які не створюють релізного контенту. `n-cursor release` визначає потребу публікації через change-файли у `npm/.changes/`, тому широкий trigger запускав CI без фактичної публікації.

## Considered Options

- Залишити `npm/**` як широкий trigger для будь-яких змін у workspace.
- Замінити trigger на `npm/.changes/**`, щоб workflow запускався лише за change-файлами.

## Decision Outcome

Chosen option: "Замінити trigger на `npm/.changes/**`", because релізний flow побудований навколо change-файлів у `npm/.changes/`, а без них `n-cursor release` не публікує нічого.

### Consequences

- Good, because CI не запускається на зміни в `npm/types/`, `npm/policy/`, документації та інших файлах, що не впливають на версію пакету.
- Bad, because якщо change-файл потрапить у репозиторій без супутнього коду, workflow усе одно спрацює; transcript зазначає цей ризик як малоймовірний через `check changelog` у CI.
- Neutral, because transcript не містить підтвердження інших наслідків.

## More Information

Змінені файли з transcript:

- `.github/workflows/npm-publish.yml` — `paths: - 'npm/**'` замінено на `paths: - 'npm/.changes/**'`.
- `.cursor/rules/n-npm-module.mdc` — оновлено канонічний snippet у розділі `## CI / .github/workflows/npm-publish.yml`.
- `npm/check-npm-module.mjs` — у `checkNpmPublishWorkflow` перевірка `paths.includes('npm/**')` замінена на `paths.includes('npm/.changes/**')` разом із повідомленням помилки.

## Update 2026-06-09

Додаткове уточнення того самого рішення:

- Trigger `npm/.changes/**` узгоджується з pre-commit hook, який блокує коміт без change-файлу.
- У transcript цього драфта згадано зміну `.cursor/rules/n-npm-module.mdc` і `.github/workflows/npm-publish.yml`; Rego-перевірка порівнює workflow з канонічним snippet у правилі.
- Change-файл для цієї зміни: `.changes/260609-0656.md` з bump `patch` і section `Changed`.
