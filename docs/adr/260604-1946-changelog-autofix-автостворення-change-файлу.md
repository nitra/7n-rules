---
type: ADR
title: "Autofix-режим правила changelog: автостворення change-файлу у pre-commit хуку"
---

# Autofix-режим правила changelog: автостворення change-файлу у pre-commit хуку

**Status:** Accepted
**Date:** 2026-06-04

## Context and Problem Statement

Pre-commit хук `npm-changelog` (через `hk.pkl`) блокував коміт із помилкою `❌ npm: є релевантні зміни, але немає change-файлу` для workspace `npm/**` без change-файлу у `.changes/*.md`. Правило `changelog` мало лише check-concern без можливості автоматично усунути порушення — розробник щоразу мусив вручну виконувати `npx @nitra/cursor change --bump ... --section ... --message "..."` перед кожним комітом.

## Considered Options

* Autofix у самому правилі: правило `changelog` за умови явного прапорця само створює change-файл і стейджить його через `git add`
* Ручний крок: зберегти поведінку `fail` і вимагати від розробника самостійно класти change-файл до коміту
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Autofix у самому правилі", because user явно вказав: хук має не падати, а сам створювати change-файл. Дефолти `bump=patch` / `section=Changed` погоджено з user; `message` = subject останнього коміту (fallback: назва гілки → літерал `оновлення`).

### Consequences

* Good, because pre-commit хук `npm-changelog` більше не блокує коміт: якщо change-файлу немає, він створюється автоматично і одразу стейджується (`git add`), підтверджено наскрізним прогоном `N_CURSOR_CHANGELOG_AUTOFIX=1 ... fix changelog`.
* Good, because прибрався deprecation-ворнінг про команду `check` — крок `hk.pkl` перемкнуто на `fix` із env-прапорцем.
* Bad, because autofix ставить `message` = subject *попереднього* коміту (subject поточного на pre-commit ще не існує), тому опис у change-файлі може бути неточним і потребувати ручного редагування перед push.
* Bad, because у CI (`fix changelog` без env `N_CURSOR_CHANGELOG_AUTOFIX=1`) режим вимкнено навмисно, щоб не плодити сміттєвих change-файлів — розробник у CI мусить класти файл явно.

## More Information

- Реалізація: `npm/rules/changelog/js/consistency.mjs` — нові функції `resolveAutoChangeMessage`, `reportOrFixMissingChangeFile`; прапорець `opts.autofix || process.env.N_CURSOR_CHANGELOG_AUTOFIX === '1'`.
- Хук: `hk.pkl` — крок `npm-changelog` змінено з `check = "bun ./npm/bin/n-cursor.js check changelog"` на `fix = "N_CURSOR_CHANGELOG_AUTOFIX=1 bun ./npm/bin/n-cursor.js fix changelog"`.
- Тести: 4 нові кейси у `npm/rules/changelog/js/tests/consistency/tests/check.test.mjs`; 48/48 проходять.
- Документація: `npm/rules/changelog/changelog.mdc` (версія 3.2 → 3.3), `npm/rules/changelog/js/docs/consistency.md` — додано опис `opts.autofix`.
- Change-файл на саму зміну: `npm/.changes/260604-1936.md` (`bump: minor`, `section: Added`).
- Залежна бібліотека: `npm/rules/release/lib/change-file.mjs` → `writeChange()` / `readChangeFiles()`.

## Update 2026-06-05

### Виключення `npm view` з autofix-режиму

В autofix-режимі `checkPublishedWorkspace` виконував `npm view` (мережевий запит до реєстру) для drift-перевірки версій, навіть якщо мета хука — лише переконатися в наявності change-файлу. Вирішено: у autofix-режимі пропускати `npm view` і всю перевірку version-drift повністю.

**Причина:** користувач явно вказав «взагалі прибери npm view з хуку».

- Good, because прогін займає 0.43s без мережевого запиту; повідомлення `autofix-режим, реєстрову перевірку version пропущено (без npm view)` підтверджено.
- Bad, because ручний drift-бамп `version` у `package.json` більше не виявляється у pre-commit; catching drift перекладається повністю на CI та ручний `fix changelog` без env-прапора.

Реалізація: у `checkPublishedWorkspace` (`npm/rules/changelog/js/consistency.mjs`): якщо `autofix === true`, блок `resolvePublishedVersion` / version-drift пропускається, перехід одразу до перевірки `.changes/` і git-diff. Тест підтверджує: `getPublishedVersion`-мок не викликається при `autofix: true` (49/49 pass). Оновлено `npm/rules/changelog/changelog.mdc` (version 3.3) і `docs/consistency.md`.
