# Єдина glob-форма для Type-A умов у `rules/*/meta.json`

**Status:** Accepted
**Date:** 2026-05-31

## Context and Problem Statement

Функція `detectAutoRules()` у `npm/scripts/auto-rules.mjs` визначає, які правила пакету автоматично пропонувати при sync, через різнорідні predicate-функції: `anyFile`, `rootFile`, `dir`, `glob` — кожен з окремою логікою в коді. Для міграції 33 правил на data-driven `rules/*/meta.json` (Spec B) треба вибрати уніфіковану форму декларації для 13 правил (Type A), що детектуються за наявністю файлів або каталогів.

## Considered Options

- Окремі ключі `anyFile`, `rootFile`, `dir`, `glob` у `meta.json` — за аналогією до поточних назв predicate-функцій у коді.
- Єдина форма `{ "glob": "<pattern>" }` (рядок або масив рядків) — для всіх 13 правил Type A.

## Decision Outcome

Chosen option: "Єдина `{ \"glob\": \"...\" }` форма для всіх Type-A умов", because glob природно кодує всі варіанти без окремих примітивів: `package.json` матчить лише в корені (без `**/`), `**/Cargo.toml` — будь-де у дереві, `**/k8s/**` — наявність каталогу, масив рядків дає OR-семантику без додаткового синтаксису. Код парсера `auto-rules.mjs` зводиться до одного matchers-блоку замість чотирьох.

### Consequences

- Good, because єдина форма для всіх 13 правил Type A спрощує схему `rule-meta.json` і прибирає спецкейси з парсера.
- Good, because масив `{ "glob": ["a", "b"] }` дає OR-семантику без нового синтаксису.
- Neutral, because `<dir>/**` спрацьовує лише якщо каталог непорожній, тоді як попереднє `existsSync(dir)` тригерило і на порожній каталог. Transcript визнає цю зміну семантики прийнятною: `k8s/`, `.github/workflows/` та `npm/` на практиці завжди непорожні.

## More Information

Повна схема поля `auto` у `rules/*/meta.json` (Spec B): `"завжди"` (Type B — пропонувати завжди), `["rule", …]` (Type C — за наявністю залежних правил у `.n-cursor.json`), `{ "glob": "..." }` (Type A — за файловою умовою), `{ "predicate": "...", "arg"?: ... }` (Type D — незводимі до glob умови). Реєстр predicate-функцій для Type D: `npm/scripts/lib/rule-predicates.mjs` (6 предикатів: `repoUrlMarker`, `gqlTaggedTemplate`, `hasuraConfigMarker`, `depInAnyPackageJson`, `jsBunDbSignal`, `nestedPackageWithoutVite`). Glob-мапінг усіх 13 правил Type A зафіксовано у spec `docs/superpowers/specs/2026-05-31-rule-meta-json-design.md`. На момент кінця сесії реалізація Spec B ще не розпочата (0 файлів `rules/*/meta.json`).

## Update 2026-05-31

Підтвердження рішення з паралельної документації: glob-форма обрана як єдина для всіх Type-A умов; `<dir>/**` не спрацьовує для порожнього каталогу — transcript явно визнає зміну семантики прийнятною (`k8s/`, `.github/workflows/`, `npm/` на практиці завжди непорожні). CLI `n-cursor worktree` виводить фактичний шлях після `add`, щоб агент не вгадував санітизовану форму. Реєстр predicate-функцій для Type D підтверджено: 6 функцій у `npm/scripts/lib/rule-predicates.mjs`.
