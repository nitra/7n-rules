---
type: ADR
title: "Runbook n-fix: усунення порушень n-changelog та стан cspell"
---

# Runbook n-fix: усунення порушень n-changelog та стан cspell

**Status:** Accepted
**Date:** 2026-05-09

## Контекст

`npx @nitra/cursor check` повертав `❌` для правила `changelog` — були відсутні `CHANGELOG.md` у кореневому workspace `n-cursor` (`1.0.0`) та у `demo/`, хоча `npm/CHANGELOG.md` вже існував і був актуальний. Workspace `demo` (`private: true`) та кореневий пакет не мали цих файлів, бо додавались поступово й вимога поширилась на них пізніше.

## Рішення/Процедура

1. Прочитати `npm/CHANGELOG.md` та `git diff dev..HEAD` — визначити обсяг змін для нового запису.
2. Збумпити версію кореневого `package.json`: `1.0.0 → 1.0.1`.
3. Створити `CHANGELOG.md` в корені з записом `[1.0.1] - 2026-05-09` (секції Added/Changed/Removed по зводу змін гілки відносно `dev`).
4. Створити `demo/CHANGELOG.md` з початковим записом `[0.0.0] - 2026-05-09` (пакет `private: true`, змін не було).
5. Запустити `oxfmt .` — форматування зачепило `.n-cursor.json`, `npm/scripts/auto-skills.mjs`, `npm/scripts/check-hasura.mjs`, `npm/scripts/utils/bun-sql-scan.mjs`, `npm/scripts/utils/conn-file-rules.mjs`.
6. Перевірити нові файли через `npx cspell CHANGELOG.md demo/CHANGELOG.md` — прибрати технічні терміни з тексту, щоб не додавати нових зауважень поверх 680 пре-існуючих.
7. `npx @nitra/cursor check` → **14/14 правил без зауважень**.

## Обґрунтування

Правило `n-changelog` вимагає власного `CHANGELOG.md` у кожному workspace з `package.json.workspaces`, у кореневому пакеті та у `npm/`. Правило не допускає виключень для `private`-пакетів, тому єдиний шлях — створити відсутні файли та збумпити версію.

## Розглянуті альтернативи

Не обговорювались — правило не допускає виключень для `private`-пакетів.

## Зачіпає

`package.json` (root, version bump), `CHANGELOG.md` (новий), `demo/CHANGELOG.md` (новий), `npm/CHANGELOG.md` (вже існував, не змінювався).

---

## Факт: 680 пре-існуючих зауважень cspell

`bun run lint-text` при перевірці всього репо видає близько 680 `cspell`-зауважень у 91 файлі (терміни `rego`, `conftest` у `package.json` та інших місцях). Ці порушення існували до сесії `/n-fix` і не є її наслідком. Під час сесії нові файли перевірялись окремо через `npx cspell <files>` і виправлялись до нуля зауважень. Розчистка пре-існуючих зауважень — окрема задача: потрібно додати технічні терміни у `.cspell.json#words`, до словника `@nitra/cspell-dict` або позначити конкретні рядки `// cspell:ignore`.
