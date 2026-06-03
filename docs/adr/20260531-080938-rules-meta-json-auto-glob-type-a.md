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

## Update 2026-05-31

### Glob-форма для файлових умов Type A (13 правил)

Первинний дизайн передбачав три форми: `anyFile`, `rootFile`, `dir`. Уніфіковано до єдиної glob-форми `{ "glob": "<pattern>" }` (рядок або масив рядків):
- `package.json` — тільки корінь (без `**/`).
- `**/package.json` — файл будь-де.
- `.github/workflows/**` — наявність непорожнього каталогу.

`globToRegex` перевикористано з `npm/rules/npm-module/js/package_structure.mjs:374`. Таблиця glob-маппінгу 13 правил: `docs/superpowers/specs/2026-05-31-rule-meta-json-design.md`.

**Семантична зміна**: `<dir>/**` матчить лише якщо каталог непорожній; старий `existsSync(dir)` тригерив і на порожній — прийнятна зміна (порожній `k8s/` чи `ga/` без файлів активувати правило немає сенсу).

### Увімкнення автодетекту правила `tauri` (раніше dead code)

`auto.md` правила `tauri` декларував умову `@tauri-apps/api`, але ніколи не підключався до `detectAutoRules()`. Міграцію на `meta.json` використано для виправлення: `{ "predicate": "depInAnyPackageJson", "arg": ["@tauri-apps/api"] }`. Загальний сюїт: 46 тестів (було 45).

## Update 2026-05-31

### Dogfood: ізоляція Spec B у git worktree

Реалізація Spec B ізольована у `feat/rule-meta-json` через `n-cursor worktree add` — природній dogfood нового CLI. Гілка вже існувала від попередньої сесії; worktree підключився успішно попри помилку "branch already exists".

Worktree: `.worktrees/feat-rule-meta-json`. Підтверджує: ізольована гілка не конкурує з паралельними сесіями в `main`.

### Чотири форми поля `auto` у `meta.json` правил

- `"завжди"` — правило активується безумовно.
- `["rule-id", ...]` — правило активується якщо є залежне правило.
- `{ "glob": "<pattern>" }` — файлова умова (Type A, 13 правил).
- `{ "predicate": "<name>", "arg"?: ... }` — незводимий JS-предикат (6 штук у реєстрі `rule-predicates.mjs`).

## Update 2026-05-31

### Кількісні факти Spec B (фінальний стан)

- `main` запушено: `b4d50d6..7b07bcc` — 12 комітів зі Spec B.
- 33 `meta.json` замінюють 29 `auto.md` (видалено `git rm`).
- `auto-rules.mjs` переписано: −449 рядків хардкоду (`autoRuleChecks`, `AUTO_RULE_ORDER`, `AUTO_RULE_DEPENDENCIES`).
- Автодетект `tauri` увімкнено вперше.
- 148 test files ✅, 1978 тестів passed.
- CI: `bump: minor` (Spec B) + `bump: patch` (worktree-skill fix).

## Update 2026-05-31

### Архітектурні деталі реалізації Spec B

Нові модулі: `npm/scripts/lib/rule-meta.mjs` (парсер 4 форм, 11 тестів), `npm/scripts/lib/rule-predicates.mjs` (6 предикатів: `repoUrlMarker`, `gqlTaggedTemplate`, `hasuraConfigMarker`, `depInAnyPackageJson`, `jsBunDbSignal`, `nestedPackageWithoutVite`), `npm/scripts/lib/rule-meta-helpers.mjs` (розрив циклу імпортів Task 2→Task 4), `npm/schemas/rule-meta.json`, `npm/rules/npm-module/js/rule_meta.mjs`.

`detectAutoRules` та `discoverRuleAutoActivation` зчитують `meta.json` через `readRuleMeta`; порядок і залежності — з даних, не з констант. `collectAutoRuleFacts` виконує один обхід дерева; glob-тестування без N-разового walk.

Коміти: `616f832..f02a148`. Фінальний огляд: 6/6 інтеграційних перевірок, 46/46 тестів `auto-rules.test.mjs`.

## Update 2026-05-31

### Subagent-driven реалізація: модель per-task і послідовність

9 задач виконано субагентами суворо послідовно (TDD), ff-merged у `main`, worktree прибрано. Модель per-task: haiku для data-файлів, sonnet для logic, opus для ядра й фінального review.

`globToRegex` перевикористано з `npm/rules/npm-module/js/package_structure.mjs` (вже експортувалась — без додаткової залежності). Специфікація: `docs/superpowers/plans/2026-05-31-rule-meta-json.md` (1170 рядків, коміт `f5cd64c`).
