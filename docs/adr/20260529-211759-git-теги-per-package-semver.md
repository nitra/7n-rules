---
type: ADR
title: "Per-package git-теги у форматі `<name>@<version>`"
---

# Per-package git-теги у форматі `<name>@<version>`

**Status:** Accepted
**Date:** 2026-05-29

## Context and Problem Statement

Монорепо з незалежним версіонуванням workspace: один CI-прогін може підняти кілька пакетів одночасно. Потрібна стратегія тегування git, яка точно відображає пару (пакет, версія) та дає безкоштовну базу commit-range для fallback-синтезу записів CHANGELOG із `git log`.

## Considered Options

- Per-package теги `<name>@<version>` (канон changesets/Beachball)
- Один тег на CI-прогін: `release-<timestamp>` або `v<date>`
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Per-package теги `<name>@<version>`", because лише per-package теги дають `git describe --match 'foo@*'` → commit-range для fallback-синтезу запису з комітів; єдиний тег на прогін не відображає незалежного версіонування workspace і ускладнює fallback без додаткового механізму.

### Consequences

- Good, because тег = (пакет, версія) → пряма відповідність моделі незалежного версіонування; fallback отримує commit-base безкоштовно без додаткової інфраструктури.
- Neutral, because scoped-ім'я `@nitra/cursor@1.31.0` створює вкладений git ref `refs/tags/nitra/cursor@1.31.0`; transcript зазначає, що це працює (changesets робить так само), але є tag noise при одночасному релізі кількох пакетів.

## More Information

Команда в `release`: `git tag <name>@<version> && git push origin <name>@<version>`.
Fallback commit-range: `git log <name>@<prev>..HEAD -- <ws-path> --oneline`.
Файл: `npm/scripts/release.mjs` (новий).
Spec: `docs/superpowers/specs/2026-05-29-changesets-migration.md`.
План: `docs/superpowers/plans/2026-05-29-changesets-migration.md`.

## Update 2026-06-18

- `n-cursor release` має створювати анотовані git-теги через `git tag -a <name> -m <name>` замість lightweight `git tag <name>`.
- Причина: наявний `git push --follow-tags` пушить на `origin` лише анотовані теги; lightweight-теги не потрапляли на remote, що підтверджувалось порожнім `git ls-remote --tags origin` після релізу.
- Force-update після rebase також має лишатися анотованим: `git tag -f -a <name> -m <name>`.
- Змінені точки: `npm/rules/release/release.mjs` для створення й пересування тегів; тести `npm/rules/release/js/tests/release.test.mjs` оновлено на очікування `tag -a ... -m ...`.
- Верифікація: `cd npm && npx vitest run rules/release/js/tests/release.test.mjs` → 14/14 passed.
