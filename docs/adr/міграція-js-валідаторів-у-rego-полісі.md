---
type: ADR
title: "Міграція JS-валідаторів у Rego-полісі: batch-рефакторинг"
---

# Міграція JS-валідаторів у Rego-полісі: batch-рефакторинг

**Status:** Accepted
**Date:** 2026-05-13

## Контекст

У `npm/scripts/check-*.mjs` накопичились функції перевірки VSCode-конфігів (`.vscode/extensions.json`, `.vscode/settings.json`), workflow-канонів і `package.json`-структур, які дублювали логіку вже наявних або потенційних rego-полісів. При зміні канону потрібно було правити і JS, і rego — класичне «два джерела істини», що відкривало дрифт. Паралельно `docker.mdc` містив застарілий приклад `lint-docker.yml` із прямими кроками (`oven-sh/setup-bun@v2`, `actions/cache@v5`, `bun install`), що суперечило `ga.workflow_common.rego`, де ці кроки заборонені на користь composite-action `./.github/actions/setup-bun-deps`.

## Рішення/Процедура/Факт

Проведено повний аудит усіх `check-*.mjs` і видалено JS-реалізації, що мали rego-двійника. Встановлено два паттерни активації rego-полісі:

**Паттерн A — Глобальний TARGETS:** для безумовних правил (`.markdownlint-cli2.jsonc`, `package.json` присутній у кожному пакеті) rego-полісі реєструються у масиві `TARGETS` у `lint-conftest.mjs` з `rule: '<name>'` для фільтрації за `.n-cursor.json`.

**Паттерн B — JS-оркестратор:** для умовних правил (graphql — за наявності `` gql`…` ``, nginx — за наявності `default.conf.template`, jsconfig — лише backend-пакети з `src/`) JS-скрипт `check-<rule>.mjs` спочатку перевіряє умову, потім викликає `runConftestBatch`. Полісі не реєструються у TARGETS.

Конкретні зміни:

- Видалено JS-функції `checkVscodeStylelint`, `checkVscodeText*`, `checkVscodeNginx`, тіло `checkExtensionsRecommendation` з відповідних `check-*.mjs`.
- Додано нові rego-пакети: `text.vscode_extensions`, `text.vscode_settings`, `style_lint.vscode_extensions`, `style_lint.vscode_settings`, `graphql.vscode_extensions`, `nginx_default_tpl.vscode_extensions`, `nginx_default_tpl.vscode_settings`, `docker.package_json`, `docker.lint_docker_yml`, `image_avif.package_json`.
- `js_run.jsconfig` зареєстровано через JS-оркестратор і додано тести.
- Узгоджено `docker.mdc` (v1.8 → v1.9): канонічний приклад `lint-docker.yml` переведено з 4 прямих кроків на `uses: ./.github/actions/setup-bun-deps`.
- Кількість rego-тестів зросла від 183 до 267 через `json.patch`-фікстури.
- Версії пакету: `1.9.13 → 1.9.18` по фазах рефакторингу.

## Обґрунтування

Rego є авторитетним для декларативної перевірки JSON/YAML-конфігів і дає ізольовані тести через `conftest verify`. JS залишається авторитетним лише для cross-file/FS-перевірок (існування файлів, обхід дерева, AST-аналіз), яких rego не може виконати. Conditional-правила не можна реєструвати глобально у TARGETS: `lint-conftest` фільтрує лише за активними правилами у `.n-cursor.json`, але не за per-workspace умовами. Коли полісі конфліктує з документацією (docker.mdc vs `ga.workflow_common`), спочатку узгоджується документація.

## Розглянуті альтернативи

- **Залишити JS як canonical, rego як документацію** — відхилено: дублювання без ізольованих тестів, підтримка двох місць при кожній зміні канону.
- **Глобальна реєстрація conditional-правил у TARGETS** — відхилено: false-positive для проєктів без відповідної технології (graphql, nginx, tauri).
- **Один великий rego-пакет для VSCode замість per-rule** — не обговорювалось; рішення — окремі полісі per-rule для точного фільтрування через `rule:` у TARGETS.
- **Detect-logic у самому rego через `walk`** — неможливо: `walk.match` оперує лише шляхами файлів, не вмістом дерева.

## Зачіпає

- `npm/scripts/check-js-lint.mjs`, `check-bun.mjs`, `check-text.mjs`, `check-style-lint.mjs`, `check-graphql.mjs`, `check-nginx-default-tpl.mjs`, `check-js-run.mjs`
- `npm/scripts/lint-conftest.mjs` (TARGETS)
- `npm/policy/js_lint/`, `npm/policy/bun/`, `npm/policy/text/`, `npm/policy/style_lint/`, `npm/policy/graphql/`, `npm/policy/nginx_default_tpl/`, `npm/policy/docker/`, `npm/policy/image_avif/`, `npm/policy/js_run/jsconfig/`
- `npm/mdc/docker.mdc` (v1.8 → v1.9, канон workflow)
- `npm/package.json` (v1.9.13 → v1.9.18), `npm/CHANGELOG.md`

## Update 2026-05-13

Проведено черговий пакетний аудит `check-*.mjs`; видалено JS-дублікати та переведено їх у Rego-полісі з тестами:

- `check-js-lint.mjs` — видалено `CANONICAL_LINT_JS`, `isCanonicalLintJs`, `normalizeLintJsScript`, `WHITESPACE_RE`, `nitraEslintConfigMeetsMinVersion`; додано `js_lint/package_json/package_json_test.rego` (16 тестів).
- `check-bun.mjs` — видалено `isAllowedRootDevDependency`; створено `bun/package_json/package_json_test.rego` (12 тестів).
- `check-text.mjs` — видалено `checkVscodeText`, `checkVscodeTextExtensions`, `checkVscodeTextSettings`; створено `text/vscode_extensions/` і `text/vscode_settings/` (18 тестів).
- `check-style-lint.mjs` — видалено `checkVscodeStylelint`; створено `style_lint/vscode_extensions/` і `style_lint/vscode_settings/` (28 тестів).
- `check-graphql.mjs` — видалено тіло `checkExtensionsRecommendation`; conditional-оркестрація через `runConftestBatch` (активується лише якщо в коді є gql-tagged template literals).
- `check-nginx-default-tpl.mjs` — видалено тіло `checkVscodeNginx`; conditional-оркестрація (лише якщо є `default.conf.template`).
- Нові полісі: `image_avif/package_json/` (opt-out конфіг `@nitra/minify-image`) та `text/markdownlint/` (повний канон `.markdownlint-cli2.jsonc`).
- `js_run/jsconfig/jsconfig.rego` — зареєстровано у TARGETS `lint-conftest.mjs` і додано тести.

Conditional-правила використовують патерн «JS виявляє наявність артефакту → передає файл у `runConftestBatch`», а не глобальну реєстрацію у TARGETS, оскільки Rego не має доступу до файлової системи.
