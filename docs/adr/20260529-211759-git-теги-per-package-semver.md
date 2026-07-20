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

- `n-cursor release` перейшов із lightweight tags (`git tag <name>`) на annotated tags (`git tag -a <name> -m <name>`), бо наявний `git push --follow-tags` відправляє на remote лише annotated tags.
- Для пересування тегу після rebase використовується `git tag -f -a <name> -m <name>`, щоб перезаписаний тег також залишався annotated і підхоплювався `--follow-tags`.
- Змінені місця: `npm/rules/release/release.mjs` для створення та force-оновлення тегів; `npm/rules/release/js/tests/release.test.mjs` для assertions на `tag -a ... -m ...` і `tag -f -a ... -m ...`.
- Верифікація: `cd npm && npx vitest run rules/release/js/tests/release.test.mjs` → 14/14 passed.
- Change-file: `npm/.changes/260618-1624.md` з patch bump у section `Fixed`.
