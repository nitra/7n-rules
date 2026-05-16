# Міграція `check-*.mjs` на Rego/conftest: масовий порт

**Status:** Accepted
**Date:** 2026-05-08

## Контекст

Проєкт мав понад 17 JavaScript-скриптів `check-*.mjs`, кожен із яких містив логіку перевірки конфігурацій (package.json, workflow YAML, k8s manifests тощо). Логіка була нетестованою ізольовано й дублювалася між скриптами. Попередній PoC із ga-полісями (`lint-ga.mjs`) підтвердив, що conftest + Rego — ефективна заміна для декларативних структурних перевірок.

## Рішення/Процедура/Факт

Портовано перевірки з 12 категорій check-скриптів у 36 Rego-файлів під `npm/policy/`:

- `ga/workflow_common/` — універсальні правила для кожного `.github/workflows/*.yml` (concurrency, заборона setup-bun/actions-cache, заборона backslash line-continuation у `run:`, порядок checkout перед setup-bun-deps);
- `bun/` — перевірки `bunfig.toml` (linker=hoisted) та `package.json` (packageManager, lint-скрипт, oxfmt);
- `text/` — `.oxfmtrc.json`, `.cspell.json`, `package.json`, `.markdownlint-cli2.jsonc`;
- `style_lint/`, `php/`, `js_lint/`, `js_mssql/`, `js_bun_db/`, `js_run/`, `vue/`, `graphql/`, `image_compress/`, `hasura/`, `adr/`, `capacitor/`, `abie/`, `k8s/`, `npm_module/`.

Стратегія категоризації:

- **Повний порт** (ядро — field-checking JSON/YAML/TOML без зовнішніх CLI): `check-bun`, `check-text`, `check-style-lint`, `check-php`, `check-npm-module`, `check-k8s`, продовження `check-ga`.
- **Гібрид** (JSON/YAML-частина → Rego; AST/FS/CLI-частина → JS): `check-js-lint`, `check-js-mssql`, `check-js-bun-db`, `check-js-run`, `check-vue`, `check-capacitor`, `check-graphql`, `check-image-compress`, `check-hasura`, `check-adr`.
- **Не для Rego**: `lint-ga.mjs`, `lint-rego.mjs`, `run-*.mjs`, `check-docker`, `check-image-avif`, `check-nginx-default-tpl`, `check-changelog`.

Написано `npm/scripts/lint-conftest.mjs` — єдиний runner, що читає `rules` з `.n-cursor.json`, пропускає GA-поліси (вони у `lint-ga`), і для кожної активної поліси резолвить target-файли (single або walk) та запускає conftest. Скрипт додано до кореневого `lint`.

Виправлено Rego-трап: `not is_object(missing_field)` повертає `undefined` замість `true` при відсутньому полі — замінено на `object.get(input, "field", false) == false`.

Видалено дублювання concurrency-правил із чотирьох наявних GA-полісей — тепер лише у `workflow_common`.

## Обґрунтування

Conftest спроєктований для декларативних перевірок структурованих файлів: він читає файл як `input`, Rego-правила виражають інваріанти без побічних ефектів, результати машиночитабельні й вбудовуються в існуючий `conftest test` пайплайн. JS-скрипти залишаються тонкими оркестраторами лише там, де потрібен AST-скан (oxc-parser) або FS-обхід з фільтрацією.

## Розглянуті альтернативи

- **Залишити всю логіку в JS** — відхилено: вже існував прецедент міграції GA-полісей, JS-скрипти не тестуються ізольовано.
- **Мігрувати все без винятків** — відхилено: частина скриптів залежить від зовнішніх CLI або генерує файли.
- **Один монолітний Rego-файл** — відхилено: `regal` вимагає відповідності `directory-package-mismatch`, routing у conftest залежить від структури директорій.

## Зачіпає

`npm/policy/` (36 нових `.rego`-файлів), `npm/scripts/lint-conftest.mjs` (новий runner), `npm/scripts/lint-ga.mjs` (додано прогін `workflow_common` на всіх workflows), `package.json` (додано `lint-conftest` до `lint`), `npm/policy/ga/{clean_ga_workflows,clean_merged_branch,git_ai,lint_ga}/*.rego` (видалено дублювання concurrency).
