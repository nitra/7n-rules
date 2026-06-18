---
type: ADR
title: "Зміна вимоги щодо тестів у `npm-module.mdc`: від заборони розміщення до негативних glob-патернів у `\"files\"`"
---

# Зміна вимоги щодо тестів у `npm-module.mdc`: від заборони розміщення до негативних glob-патернів у `"files"`

**Status:** Accepted
**Date:** 2026-05-15

## Контекст

Правило `npm-module.mdc` вимагало, щоб тести й фікстури знаходилися поза будь-яким шляхом, перерахованим у `package.json#files`. Це змушувало авторів npm-модулів виносити тестові файли у спеціальні директорії за межами `"files"`, що суперечило зручній практиці тримати тести поруч з кодом.

## Рішення/Процедура/Факт

Вимогу переформульовано: тести й фікстури (`*.test.mjs`, `*_test.rego`, `fixtures/`) можуть лежати поруч з кодом усередині шляхів, перерахованих у `"files"`, але `"files"` зобов'язаний містити негативні glob-патерни для їх виключення (наприклад `!**/*.test.mjs`, `!**/fixtures/**`). Змінено: `npm/rules/npm-module/npm-module.mdc` (версія `1.11` → `1.12`), дзеркало `.cursor/rules/n-npm-module.mdc`, текст `fail`-повідомлення у `npm/rules/npm-module/js/package_structure/check.mjs` (усунуто альтернативу «винеси за межі `"files"`»), `npm/package.json` (bump `1.11.5 → 1.11.6`), `npm/CHANGELOG.md`.

## Обґрунтування

Логіка перевірки `checkNoTestsInPublishedFiles` (walk + post-filter) вже реалізована через негативні glob-патерни — правило у `.mdc` приведено у відповідність до фактичного механізму перевірки. Розміщення тестів поруч з кодом зручніше для навігації й підтримки; негативний glob у `"files"` є явним, версійованим артефактом конфігурації, а не побічним ефектом розташування файлів.

## Розглянуті альтернативи

Не обговорювалися; рішення надійшло як чітка вимога від користувача.

## Зачіпає

`npm/rules/npm-module/npm-module.mdc`, `.cursor/rules/n-npm-module.mdc`, `npm/rules/npm-module/js/package_structure/check.mjs`, `npm/package.json`, `npm/CHANGELOG.md`; публічний API правила перевірки `checkNoTestsInPublishedFiles` — семантика не змінилася, лише текст помилки й дозволена топологія файлів.

## Update 2026-05-12

Додано перевірку компактності пакету у `check-npm-module.mjs`:

- `checkPackageCompactness` — перевіряє наявність поля `"files"` у `npm/package.json` та відсутність `devDependencies`.
- `checkNoTestsInPublishedFiles` — визначає glob-патерни з `"files"`, для кожного файлу перевіряє назву, приналежність до тестового каталогу (`TEST_DIR_NAMES`) та AST-імпорт тестового фреймворку через oxc-parser.
- Допоміжна функція `globToRegex` підтримує `**`, `*`, `?` та негативні патерни.
- До `"files"` у `npm/package.json` додано `"!**/*_test.rego"` — 14 rego-юніт-тестів більше не потрапляють до tarball (підтверджено `npm pack --dry-run`).
- Видалено `devDependencies: { "@nitra/cursor": ... }` з `npm/package.json` — пакет підключений через `workspace:*` у кореневому `package.json`.
- Написано 14 unit-тестів у `npm/tests/check-npm-module.test.mjs` для `globToRegex`, `findTestFrameworkImport`, `classifyPublishedFileAsTest`.
- `npm/mdc/npm-module.mdc` і `.cursor/rules/n-npm-module.mdc` оновлено до версії 1.11 з трьома новими обов'язковими вимогами: поле `"files"` є обов'язковим, `devDependencies` заборонені, тести і фікстури мають лежати поза будь-яким виданим шляхом.
- Версію підвищено з `1.9.4` до `1.9.5`, CHANGELOG оновлено.

**Розглянуті альтернативи:** Фізично перенести `*_test.rego` під `npm/tests/policy/` — відкладено, потребує рефакторингу `lint-rego.mjs` і `lint-conftest.mjs`. Залишити порожній `devDependencies: {}` — відхилено як надлишкове поле.
