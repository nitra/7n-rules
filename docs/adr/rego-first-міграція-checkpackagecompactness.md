# Rego-first міграція: видалення JS-дублікатів checkPackageCompactness і isAllowedRootDevDependency

**Status:** Accepted
**Date:** 2026-05-13

## Контекст

`check-npm-module.mjs` містив функцію `checkPackageCompactness`, яка перевіряла наявність непорожнього `files`-whitelist і відсутність `devDependencies` у `npm/package.json`. Аналогічно `check-bun.mjs` мав `isAllowedRootDevDependency` — обидві функції є пер-документними структурними deny на одному JSON-файлі й уже мали Rego-двійників у `npm/policy/`, утворюючи «два джерела істини».

## Рішення/Процедура/Факт

`checkPackageCompactness` видалено з `check-npm-module.mjs`. Два нові `deny` (`files` обов'язковий і непорожній; `devDependencies` заборонені) додано до `npm/policy/npm_module/npm_package_json/npm_package_json.rego`. Написано `npm_package_json_test.rego` — happy path + 7 негативних кейсів через `json.patch`.

`isAllowedRootDevDependency` видалено з `check-bun.mjs`. Rego-покриття перенесено до `npm/policy/bun/package_json/package_json_test.rego` (12 тестів).

`check-js-lint.mjs` також очищено від dead exports (`CANONICAL_LINT_JS`, `isCanonicalLintJs`, `normalizeLintJsScript`, `WHITESPACE_RE`, `nitraEslintConfigMeetsMinVersion`), що мали Rego-двійників. Відповідні `describe`-блоки видалено з `.test.mjs` файлів; покриття перенесено у `package_json_test.rego` (16 тестів).

До `conftest.mdc` додано STOP-блок перед будь-яким `Edit` `check-*.mjs` — вимагає спершу перевірити, чи задача не є пер-документною. Аналогічне нагадування у 3-пунктовому self-check додано до `npm/.claude-template/npm-CLAUDE.md`.

## Обґрунтування

Пер-документні структурні deny (наявність ключа, форма поля) — типовий Rego-use-case: декларативно, тестується `conftest verify`, інтегрується у `lint-rego`. JS виправданий лише тоді, коли потрібен FS-walk або AST-парсинг — `checkNoTestsInPublishedFiles` залишився у JS саме тому.

## Розглянуті альтернативи

Залишити у JS (відхилено — порушує `conftest.mdc`); гібридний підхід deny у Rego + виклик з JS (надмірно); зберегти JS-версії для наочності (відхилено — docstring-посилання на Rego-namespace достатньо).

## Зачіпає

`npm/policy/npm_module/npm_package_json/npm_package_json.rego`, `npm/policy/npm_module/npm_package_json/npm_package_json_test.rego`, `npm/policy/bun/package_json/package_json_test.rego`, `npm/policy/js_lint/package_json/package_json_test.rego`, `npm/scripts/check-npm-module.mjs`, `npm/scripts/check-bun.mjs`, `npm/scripts/check-js-lint.mjs`, `npm/tests/check-js-lint.test.mjs`, `npm/tests/check-bun.test.mjs`, `.cursor/rules/conftest.mdc`, `npm/CLAUDE.md`, `npm/.claude-template/npm-CLAUDE.md`.
