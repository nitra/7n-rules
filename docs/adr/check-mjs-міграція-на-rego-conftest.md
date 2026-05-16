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

## Update 2026-05-08

Після додавання 19 Rego-поліситів у `npm/policy/` видалено дублюючі функції з кожного `check-*.mjs`: з `check-bun.mjs` — `checkBunfigHoisted`, `checkDevDependencies`, `checkPackageManager`, `checkLintAggregate`; з `check-text.mjs` — `checkOxfmtRc`, `checkCspell`, `checkMarkdownlint`, `checkPackageJsonLintTextScript`; з `check-js-lint.mjs` — `checkPackageJsonDeps`, `checkPackageJsonTypeModule`, `checkEnginesNode/Bun`; з `check-js-run.mjs` — `checkJsConfigFile`, `loadPackageJsonAndCheckBunyanDeps`; з `check-graphql.mjs` — `checkPackageDumpSchemaScript`; з `check-image-compress.mjs` — перевірки скрипту `lint-image` та `@nitra/minify-image` у devDeps; з `check-ga.mjs` — дублюючі виклики `verifyConcurrencyBlock` та суміжних функцій (вже виконуються через `lint-conftest` → `ga.workflow_common`); з `check-adr.mjs` — `hasHookInStopGroup`. JS-частина лишається авторитетною лише там, де потрібні FS-обходи, cross-file логіка, git-операції або AST-парсинг через `oxc-parser`. Тести до видалених перевірок позначено `test.skip` або переформульовано з посиланням на відповідний Rego namespace. Версія `1.8.207 → 1.8.209`.

## Update 2026-05-10

Завершено повну міграцію пер-документних перевірок K8s і abie у Rego-полісі (v1.8.222–1.8.223). Закодовано правило «Rego першим» у `.cursor/rules/conftest.mdc` (alwaysApply).

**Фаза 5 (k8s) — 10 нових пакетів:**
- Розширено `npm/policy/k8s/manifest/manifest.rego` (Deployment `resources.requests.cpu+memory`, Hasura image pin, canonical `topologySpreadConstraints`).
- Нові пакети: `gateway`, `kustomization`, `svc_yaml`, `svc_hl_yaml`, `base_manifest`, `base_kustomization`, `kustomize_managed`, `hasura_configmap`, `hasura_httproute`, `hpa_pdb`. До кожного — `*_test.rego`. Разом 93 тести, усі проходять `conftest verify`.

**Фаза 6 (abie) — нові та виправлені пакети:**
- Додано пакети `base_deployment_preem` та `clean_merged_ignore_branches`.
- Виправлено баг у `health_check_policy.rego`: неправильний шлях `spec.config.*` → `spec.default.config.*`; переписано пакет і додано 10 тестів.
- Додано `_test.rego` для `http_route_base`.

**Оркестрація:**
- `lint-rego.mjs` — додано опційний `conftest verify -p npm/policy` (graceful skip, якщо `conftest` не в PATH).
- `lint-conftest.mjs` — додано TARGETS для нових k8s- і abie-пакетів.
- `.cursor/rules/conftest.mdc` — нова секція «Пріоритет: Rego першим» із decision-tree та переліком JS-only винятків.

**Ключовий баг, знайдений під час написання тестів:** `not is_object(input.spec)`, коли поле `spec` відсутнє, поводиться як `undefined` (не `false`) — deny-правило мовчки не спрацьовує. Рішення: `object.get(input, "spec", null)`. Виправлено у 7 пакетах. Детальніше — у ADR `rego-js-mirror-drift-та-object-get.md`.

## Update 2026-05-10

### Впровадження стратегії «Rego-first» — повна реалізація (Phase 6)

Алгоритм «Rego-first» закріплено у `.cursor/rules/conftest.mdc` (`alwaysApply: true`): пер-документні перевірки (single YAML/JSON, kind/apiVersion, поля, форма масивів) → Rego; cross-file/FS/autofix/pre-YAML text → JS; гібрид → обидва шари. Path-scoped нагадування «Перш ніж писати `check-*.mjs` — оціни, чи задача лягає на rego-полісі» додано до `npm/.claude-template/npm-CLAUDE.md`.

**Утиліта `runConftestBatch`** (`npm/scripts/utils/run-conftest-batch.mjs`): батчений виклик `conftest test <files...> -p <policyDir> --namespace <ns> --output json`, повертає структурований масив `{ filename, namespace, message }[]`. Hard-fail (exit 1) якщо `conftest` відсутній у PATH з install-hint. Продуктивність: ~80-150ms на namespace незалежно від кількості файлів.

**Plan B — pilot на abie:** видалено JS-функції `abieBaseHttpRouteHostnamesErrors`, `deploymentDocumentHasAbieBasePreemNodeSelector`, `parseCleanMergedIgnoreBranches`, `ignoreBranchesIncludesRequired`, `validateAbieHcPolicy` та пов'язані хелпери. Orchestrator-функції в `check-abie.mjs` делегують conftest 4 пакетам: `abie.base_deployment_preem`, `abie.clean_merged_ignore_branches`, `abie.health_check_policy`, `abie.http_route_base`. Виправлено drift-bug: `health_check_policy.rego` читав `spec.config` замість `spec.default.config`. Крос-чек тест `cross-check-rego-abie.test.mjs` (25 тестів) підтвердив детекцію дрейфу до видалення JS-копій, після чого видалено як надлишковий.

**check-ga.mjs:** на початку `check()` додано `runAllGaRego()` — 5 викликів `runConftestBatch` (4 per-workflow + 1 `ga.workflow_common`). `lint-ga.mjs` спрощено: прибрано `CONFTEST_TARGETS`, `runConftestStep`, `runConftestWorkflowCommon`; функція `runLintGaCli` тепер `async`, завершується `await checkGa()`.

Зачіпає: `npm/scripts/check-abie.mjs`, `npm/scripts/check-ga.mjs`, `npm/scripts/lint-ga.mjs`, `npm/scripts/utils/run-conftest-batch.mjs` (новий), `npm/policy/abie/` (4 пакети + `_test.rego`), `npm/tests/check-abie.test.mjs`, `.cursor/rules/conftest.mdc`, `npm/.claude-template/npm-CLAUDE.md`.
