---
type: ADR
title: "npm-пакет: компактність — `files`, заборона `devDependencies`, тести поза опублікованим деревом"
---

# npm-пакет: компактність — `files`, заборона `devDependencies`, тести поза опублікованим деревом

**Status:** Accepted
**Date:** 2026-05-12

## Контекст

Пакет `@nitra/cursor` публікував зайві файли через відсутність явного whitelist у полі `files` в `npm/package.json`. Поле `devDependencies` знаходилось безпосередньо у `npm/package.json` замість кореневого — вони не встановлюються при `npm install`, але вводять в оману. Тести й фікстури потенційно потрапляли до опублікованого tarball, оскільки не було жодного правила ні в `npm-module.mdc`, ні в `check-npm-module.mjs`, що б це виявляло.

## Рішення/Процедура/Факт

`npm/mdc/npm-module.mdc` (v1.10 → 1.11) та дзеркало `.cursor/rules/n-npm-module.mdc` доповнено секцією «Компактний пакет» з трьома вимогами: (1) поле `files` обов'язкове як whitelist; (2) тести й фікстури (`*.test.*`, `*.spec.*`, каталоги `tests/`/`fixtures/` тощо) не мають потрапляти до жодного опублікованого шляху — виняток: `*_test.rego` (conftest-конвенція: юніт-тест поруч із полісі в одному Rego-пакеті); (3) `devDependencies` у `npm/package.json` заборонені — їх місце у кореневому `package.json`.

До `npm/scripts/check-npm-module.mjs` додано нові константи `TEST_DIR_NAMES` і `TEST_FILE_PATTERNS`, функції `globToRegex`, `findTestFrameworkImport` (AST через `oxc-parser`) та `classifyPublishedFileAsTest`, а також дві нові перевірки — `checkPackageCompactness` і `checkNoTestsInPublishedFiles`.

З `npm/package.json` прибрано `devDependencies` (пакет `@nitra/cursor` вже присутній у кореневому `package.json` як `workspace:*`). Написано 14 нових юніт-тестів у `npm/tests/check-npm-module.test.mjs`. Версію підвищено до `1.9.5`.

## Обґрунтування

Явний `files` whitelist гарантує відсутність непотрібних файлів у tarball без покладання на `.npmignore`. `devDependencies` у пакеті-модулі не потрапляють до користувача, але додають плутанину — їх місце в кореневому `package.json`. Перевірку тестів реалізовано в JavaScript через AST, оскільки Rego не підтримує `readdir` і не парсить JS. Rego-тести (`*_test.rego`) є законним винятком: `conftest` вимагає `_test.rego` у тому самому каталозі, що й `package`-декларація, тому фізичне переміщення зламає conftest-прогони.

## Розглянуті альтернативи

- Негативний glob `"!**/*_test.rego"` у `files` — прийнятий спочатку, але відхилений: rego-тести є законним вмістом `policy/` і мають публікуватись разом з основними полісі.
- Фізичне перенесення `*_test.rego` з `policy/` до `npm/tests/policy/` — коректніше за духом правила, але потребує рефакторингу `lint-rego.mjs` і `lint-conftest.mjs`; відкладено на майбутнє.
- Перенести `checkPackageCompactness` у Rego-полісі `npm/policy/npm_module/npm_package_json/npm_package_json.rego` — перевірка одного JSON-документа природно лягає в Rego, але не реалізовано у цій сесії.

## Зачіпає

`npm/mdc/npm-module.mdc`, `.cursor/rules/n-npm-module.mdc`, `npm/scripts/check-npm-module.mjs`, `npm/tests/check-npm-module.test.mjs` (новий файл), `npm/package.json`, `npm/CHANGELOG.md`

## Update 2026-05-12

Деталі реалізації правил компактності та rego-authoritative перевірок:

- `npm/policy/npm_module/npm_package_json/npm_package_json.rego`: два `deny` — обов'язковий непорожній `files` (3 варіанти порушення) і заборона `devDependencies`; `npm_package_json_test.rego` з 7 негативними кейсами (141/141 тестів).
- `npm/scripts/check-npm-module.mjs`: `checkPackageCompactness` видалено (перенесено у rego); залишено `checkNoTestsInPublishedFiles` (FS-walk + oxc-parser AST). Нові допоміжні функції: `globToRegex`, `findTestFrameworkImport`, `classifyPublishedFileAsTest`; `TEST_FRAMEWORK_MODULES` — перелік з 8 модулів.
- `npm/tests/check-npm-module.test.mjs`: 14 нових тестів для glob-matcher, AST-імпортів, класифікації test-файлів.
- `npm/package.json`: прибрано `devDependencies` (`@nitra/cursor` залишається у кореневому `workspace:*`); прибрано тимчасовий негативний glob `!**/*_test.rego`; версія 1.9.4 → 1.9.5.
- `conftest.mdc` + `npm/CLAUDE.md`: додано STOP-блок «перед редагуванням `check-*.mjs` — перевір, чи не rego-задача»; у переліку «JS-only» явно вказано AST-парсинг та FS-walk.
- Конвенція: `*_test.rego` залишається поруч із policy (conftest-пакет) — негативний glob у `files` не потрібен.
