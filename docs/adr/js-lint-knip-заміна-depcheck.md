---
type: ADR
title: "Міграція перевірки невикористаних залежностей: `depcheck` → `knip`"
---

# Міграція перевірки невикористаних залежностей: `depcheck` → `knip`

**Status:** Accepted
**Date:** 2026-05-12

## Контекст

У проєкті `@nitra/cursor` перевірка невикористаних npm-залежностей виконувалась через `depcheck` як окремий крок у CI (`.github/workflows/npm-publish.yml`) та як окреме правило в `js-run.mdc` з path-scoped конфігурацією для backend workspace-пакетів. Інструмент потребував явного переліку ігнорованих пакетів (`npx depcheck --ignores="graphql,bun,..."`) і не інтегрувався з рештою JS-лінтерів.

## Рішення/Процедура/Факт

- `js-lint.mdc` (v1.17 → v1.18) та дзеркало `.cursor/rules/n-js-lint.mdc` — додано секцію «knip»; канонічний скрипт `lint-js` стає `bunx oxlint --fix && bunx eslint --fix . && bunx jscpd . && bunx knip`; аналогічний крок додано до `lint-js.yml`; прописано обов'язковий `knip.json` у корені з `ignoreDependencies: ["graphql"]`.
- `js-run.mdc` (v1.6 → v1.7) та `.cursor/rules/n-js-run.mdc` — повністю прибрано секцію «depcheck у GitHub Actions з path-фільтром».
- `ga.mdc` (v1.8 → v1.9) та `.cursor/rules/n-ga.mdc` — додано заборону: `depcheck` не використовувати у workflows.
- `npm/policy/ga/workflow_common/workflow_common.rego` — новий `deny`-рядок, що забороняє `depcheck` у будь-якому `run:`-кроці workflows.
- `npm/policy/js_lint/package_json/package_json.rego` та `lint_js_yml.rego` — оновлено `canonical_lint_js` і перевірку наявності `bunx knip` у CI.
- `npm/scripts/utils/depcheck-workflow.mjs` — видалено; з `check-js-run.mjs` прибрано `checkDepcheckInWorkflows`; у `check-js-lint.mjs` додано `checkKnipConfig` (перевірка `knip.json` з `graphql` у `ignoreDependencies`).
- `npm/tests/check-js-run-fixture.test.mjs` — прибрано 9 тест-кейсів `describe('check-js-run: depcheck у path-scoped workflow', …)` і допоміжний helper.
- Репо: прибрано `npx depcheck` з `.github/workflows/npm-publish.yml`; `bunx knip` додано до `.github/workflows/lint-js.yml`; створено `knip.json` з `ignoreDependencies: ["graphql"]`; `package.json` оновлено.
- Версія npm-пакету: 1.9.4 → 1.9.5; CHANGELOG оновлено.

## Обґрунтування

Консолідація всіх lint-перевірок в одному місці (`js-lint.mdc`) усуває необхідність окремої секції в `js-run.mdc` і окремого CI-кроку. `knip` є сучасним стандартом перевірки невикористаних залежностей і exports: підтримує monorepo-workspace, ESM, TypeScript без зайвої конфігурації. `graphql` потрапляє до `ignoreDependencies`, оскільки є peer-залежністю, яку `knip` помилково позначає як зайву.

## Розглянуті альтернативи

Не обговорювались — інструмент (`knip`) і місце розміщення правила (`js-lint.mdc`) були задані у вимогах.

## Зачіпає

`npm/mdc/js-lint.mdc`, `npm/mdc/js-run.mdc`, `npm/mdc/ga.mdc`, `.cursor/rules/n-js-lint.mdc`, `.cursor/rules/n-js-run.mdc`, `.cursor/rules/n-ga.mdc`, `npm/scripts/check-js-lint.mjs`, `npm/scripts/check-js-run.mjs`, `npm/scripts/utils/depcheck-workflow.mjs` (видалено), `npm/policy/ga/workflow_common/workflow_common.rego`, `npm/policy/js_lint/package_json/package_json.rego`, `npm/policy/js_lint/lint_js_yml/lint_js_yml.rego`, `.github/workflows/npm-publish.yml`, `.github/workflows/lint-js.yml`, `package.json`, `knip.json` (новий), `npm/package.json`, `npm/CHANGELOG.md`

## Update 2026-05-12

Деталі реалізації міграції depcheck → knip:

- Канонічний `lint-js`: `bunx oxlint --fix && bunx eslint --fix . && bunx jscpd . && bunx knip`.
- `knip.json` у корені: `ignoreDependencies: ["graphql"]` (peer-dep `@nitra/graphql-request`), `ignoreBinaries`, `workspaces.npm.entry`, `ignore` для монорепо.
- Rego-полісі `ga.workflow_common`: `deny` на наявність `depcheck` у будь-якому `run:`-кроці workflow.
- `npm/scripts/utils/depcheck-workflow.mjs` видалено; `checkDepcheckInWorkflows` прибрано з `check-js-run.mjs`.
- `check-js-lint.mjs`: оновлено `CANONICAL_LINT_JS`, додано `checkKnipConfig` (перевірка `knip.json` з `graphql` у `ignoreDependencies`).
- `.github/workflows/lint-ga.yml`: доданий відсутній крок `Install conftest` — без нього `runConftestBatch` у `check-ga.mjs` падав.
- Версія пакета: 1.9.4 → 1.9.5 (потім підвищена до 1.9.6 через merge-конфлікт із main при злитті PR).

## Update 2026-05-13

Створено `npm/scripts/utils/knip-canonical.json` — baseline-конфіг для `knip.json` проєкту-споживача з покриттям 9 категорій false-positives: `entry` (CLI-конфіги eslint/stylelint/oxlint/jscpd/markdownlint-cli2/commitlint), `project`, `ignore`, `ignoreDependencies` (`@nitra/cspell-dict`, `@cspell/dict-.*`, `graphql`), `ignoreBinaries` (actionlint, cspell, eslint, git-ai, jscpd, markdownlint-cli2, oxfmt, oxlint, shellcheck, uvx, v8r, zizmor).

Семантика перевірки в `checkKnipConfig` змінена на перевірку **лише наявності** `knip.json`: якщо файл відсутній — автоматично копіюється `knip-canonical.json` у корінь (side-effect, описано у `js-lint.mdc`). Вміст наявного файлу не валідується — проєкти можуть довільно розширювати конфіг.

Канонічний рядок `lint-js` доповнено прапором `--no-config-hints` (`bunx oxlint --fix && bunx eslint --fix . && bunx jscpd . && bunx knip --no-config-hints`). Прапор придушує «Configuration hints» для навмисних записів `ignoreDependencies` (наприклад, `graphql` як peer-залежність без прямого import). Оновлено: `CANONICAL_LINT_JS` у `check-js-lint.mjs`, `canonical_lint_js` у `npm/policy/js_lint/package_json/package_json.rego`, кореневий `package.json`, `js-lint.mdc` v1.21, `.cursor/rules/n-js-lint.mdc`, `.github/workflows/lint-js.yml`.

Зачіпає: `npm/scripts/utils/knip-canonical.json` (новий), `npm/scripts/check-js-lint.mjs`, `npm/policy/js_lint/package_json/package_json.rego`, `npm/policy/js_lint/package_json/package_json_test.rego` (16 тестів), `npm/mdc/js-lint.mdc` v1.21, `.cursor/rules/n-js-lint.mdc`, `package.json`, `.github/workflows/lint-js.yml`.

## Update 2026-05-13

### Прапор `--no-config-hints` у канонічному `lint-js` скрипті

Canonical рядок `lint-js` доповнено прапором: `bunx oxlint --fix && bunx eslint --fix . && bunx jscpd . && bunx knip --no-config-hints`. Оновлено синхронно у: `npm/scripts/check-js-lint.mjs`, `npm/policy/js_lint/package_json/package_json.rego` (константа `canonical_lint_js`), `package.json` root (`scripts.lint-js`), `npm/mdc/js-lint.mdc`, `.cursor/rules/n-js-lint.mdc`, `.github/workflows/lint-js.yml`. Rego-deny для підрядка `bunx knip` у lint-js.yml залишився сумісним (перевірка через `contains`).

Pричина: knip виводив інформаційну секцію «Configuration hints» (`Remove from ignoreDependencies`) при кожному запуску CI, засмічуючи вивід без реального порушення правил. Прапор усуває шум без пригнічення справжніх перевірок.

### Канонічний `knip.json` — перевірка лише наявності, auto-create з канону

Створено `npm/scripts/utils/knip-canonical.json` з категоріями false-positive: CLI-конфіги не-JS через `npx/bunx`, пакети з посиланнями лише в JSON/YAML, devDep-бінарники. `check-js-lint.mjs::checkKnipConfig` перевіряє **лише наявність** `knip.json`; якщо відсутній — автоматично копіює канон і звітує pass. Стара перевірка `ignoreDependencies ∋ "graphql"` та мертві JS-константи `CANONICAL_LINT_JS`, `isCanonicalLintJs`, `normalizeLintJsScript` — видалені.

Патерн «canonical baseline + auto-create при відсутності» вже затверджений для `oxlint-canonical.json`. Вміст `knip.json` залежить від проєкту — обовʼязковість конкретних полів не має сенсу enforce-ити; єдина вимога — файл має існувати.
