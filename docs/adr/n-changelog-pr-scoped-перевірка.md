---
type: ADR
title: "Правило n-changelog — PR-scoped перевірка CHANGELOG у Bun-монорепо"
---

# Правило n-changelog — PR-scoped перевірка CHANGELOG у Bun-монорепо

**Status:** Accepted
**Date:** 2026-05-05

## Контекст

У Bun-монорепо кожен workspace має власний `package.json` із версією, але не існувало механізму, що примушував би розробника оновлювати `CHANGELOG.md` перед зливанням PR. Правило `n-npm-module` покривало лише workspace `npm/`; для інших workspace-ів гарантії не було.

## Рішення/Процедура/Факт

Створено нове правило `changelog` (`npm/mdc/changelog.mdc`, `.cursor/rules/n-changelog.mdc`, `npm/scripts/check-changelog.mjs`). Логіка CHANGELOG-перевірки перенесена з `check-npm-module.mjs` до `check-changelog.mjs`; workspace `npm/` більше не є винятком.

Правило реалізує дві моделі бази порівняння:
- **npm-published** — для workspace-ів з оголошеним `package.json.files`: локальна `version` порівнюється з опублікованою в реєстрі npm (`npm info <name> version`); якщо версії рівні — зміни вважаються вже відрелізованими, перевірка пасує.
- **local-only** — для приватних workspace-ів: база = `git merge-base dev HEAD`; якщо в поточному PR є зміни у `<ws>/` — вимагаються bump `version` та запис `## [version] - YYYY-MM-DD` у `<ws>/CHANGELOG.md`.

Якщо `package.json.files` оголошено — `"CHANGELOG.md"` має бути в масиві.

Skip-логіка: не git-репо; поточна гілка = `dev`; refs `dev`/`origin/dev` не існують — перевірка тихо пропускається.

`npm-module.mdc` / `n-npm-module.mdc` підняті до версії 1.9 зі вилученою секцією `## CHANGELOG`. Правило `changelog` авто-вмикається за умовою `[bun]` через `AUTO_RULE_DEPENDENCIES`. Додано 11 тестів. Версія: 1.8.176.

## Обґрунтування

Розробник робить проміжні коміти без bump-у; обов'язок фіксувати зміни виникає один раз — при відкритті PR у `dev`. Для npm-пакетів база = опублікована версія є надійнішою, ніж `dev` (яка нетипова для npm-проектів). Для приватних workspace-ів `git merge-base` точніший за прямий `diff dev..HEAD`. Об'єднання логіки з `npm-module` в одне правило усуває дублювання.

## Розглянуті альтернативи

- **Перевірка відносно HEAD** — відхилено: не відповідає PR-семантиці.
- **База `dev` хардкодом для всіх** — прийнята на першій ітерації, відхилена для npm-published workspace-ів.
- **Пропускати приватні workspace-и** — відхилено: changelog однаково важливий для внутрішнього використання.
- **Залишити `npm/` як виняток** — переглянуто і відхилено: краще одне правило для всіх.

## Зачіпає

`npm/scripts/check-changelog.mjs` (новий), `npm/mdc/changelog.mdc` (новий), `.cursor/rules/n-changelog.mdc` (новий), `npm/scripts/check-npm-module.mjs` (видалено `checkChangelog`), `npm/mdc/npm-module.mdc` → v1.9, `.cursor/rules/n-npm-module.mdc` → v1.9, `npm/scripts/auto-rules.mjs`, `npm/bin/auto-rules.md`, `npm/tests/check-changelog.test.mjs` (новий), `npm/tests/auto-rules.test.mjs`, `npm/CLAUDE.md`, `npm/.claude-template/npm-CLAUDE.md`, `.n-cursor.json` (changelog → `disable-rules` для cursor-репо), `npm/package.json` → 1.8.176, `npm/CHANGELOG.md`.
