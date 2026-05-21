# Хибнопозитивна changelog-помилка `demo` при відсутності workspace на `dev`-гілці

**Status:** Accepted
**Date:** 2026-05-19

## Context and Problem Statement
`npx @nitra/cursor check changelog` повертає `❌ demo: у цій гілці є зміни, але version у demo/package.json не підвищено (на dev — ∅)`. Workspace `demo/` не існує на гілці `dev` (остання є `merge-base` з `main`, але відстає на ~309 комітів), тому `readBaseVersion` повертає `null`, і перевірка хибно вважає version не підвищеною.

## Considered Options
* Bump `version` у `demo/package.json` і додати запис у `demo/CHANGELOG.md`
* Залишити як є — помилка є хибнопозитивною і не може бути усунена без злиття `main → dev`

## Decision Outcome
Chosen option: "Залишити як є", because `demo/` не існує на `dev` (підтверджено: `git show dev:demo/package.json` → `fatal: path 'demo/package.json' exists on disk, but not in 'dev'`), а злиття `main → dev` виходить за межі `/n-fix` і потребує окремої авторизації.

### Consequences
* Bad, because `npx @nitra/cursor check` залишається на `11/12` — одне правило (`changelog`) показує помилку для `demo` на кожному запуску до синхронізації `dev` з `main`.
* Neutral, because transcript не містить підтвердження довготривалого ефекту.

## More Information
- Логіка перевірки: `npm/rules/changelog/fix/consistency/check.mjs:478` — `resolveMergeBase(baseRef)` → `workspaceHasRelevantChangesAgainstBase`.
- `git rev-parse dev` → `7a2ae76` (збігається з `merge-base HEAD dev`), `demo/` відсутня на цьому коміті.
- Команда для усунення: злиття `main → dev` (потребує авторизації користувача).
