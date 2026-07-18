---
type: ADR
title: "Резюме job-матриць CI: Azure vs GitHub Actions — база для уніфікації"
---

# Резюме job-матриць CI: Azure vs GitHub Actions — база для уніфікації

**Status:** Proposed
**Date:** 2026-07-18

## Context and Problem Statement

Протягом сесії реалізовано plugin-архітектуру `@7n/rules` (`@7n/rules-ci-github`, `@7n/rules-ci-azure`) і окремо, на консюмерському репозиторії `efes/backend` (Azure DevOps), побудовано matrix-подібний лінт-гейт для 18 деплой-пайплайнів. Дві моделі виявились структурно різними за трьома незалежними осями: **тригер-гранулярність** (файл-тип vs модуль-каталог), **паралелізм** (нативний по workflow-файлах vs явний job-граф) і **діапазон файлів усередині одного прогону** (git-diff vs увесь підкаталог). Мета — зафіксувати поточний стан обох моделей фактично, без ухвалення рішення, як стартову точку для окремої сесії уніфікації підходів.

## Considered Options

Це не список альтернатив рішення — це відкриті напрямки, які треба буде звести в наступній сесії:

- Чи вводити module/service-scoped лінт-гейт (як у efes/Azure) у канон `@7n/rules-ci-github` (плагін), чи це лишається консюмер-специфічним інженерним рішенням поза плагінами.
- Чи вирівнювати file-diff-гранулярність: GA-канон лінтить лише змінені файли (delta-режим за замовчуванням) у межах кожного домену; Azure-модульний job лінтить **усі** файли під `--path`-каталогом незалежно від того, що саме змінилось у коміті.
- Чи потрібен GA-аналог "лінт гейтить publish": ci-github канон не керує deploy-пайплайнами взагалі (не його відповідальність); чи є десь GA-based deploy-флоу, який слід так само гейтити, — невідомо, перевірити в наступній сесії.

## Поточний стан — GitHub Actions (`@7n/rules-ci-github`, канон плагіна)

**Модель: 10 незалежних workflow-файлів, один на домен**, кожен зі своїм glob-тригером за **типом файлу** (не за каталогом/модулем): `lint-ga.yml`, `lint-js.yml`, `lint-docker.yml`, `lint-k8s.yml`, `lint-php.yml`, `lint-python.yml`, `lint-rust.yml`, `lint-security.yml`, `lint-style.yml`, `lint-text.yml` (шаблони — `plugins/ci-github/rules/*/*/template/lint-*.yml.snippet.yml`).

Приклад (`lint-js.yml`):

```yaml
on:
  push:
    branches: [dev, main]
    paths: ['**/*.js', '**/*.mjs', '**/*.cjs', '**/*.jsx', '**/*.ts', '**/*.tsx', '**/*.vue', '**/eslint.config.*']
  pull_request:
    branches: [dev, main]
jobs:
  eslint:
    steps:
      - run: bunx n-rules lint js --no-fix
```

- **Тригер-гранулярність**: repo-wide glob за розширенням файлу — workflow фаєрить, якщо ЗМІНЕНО будь-який файл цього типу **де завгодно** в репо, незалежно від каталогу/модуля.
- **Паралелізм**: нативний і безкоштовний — GitHub планує незалежні workflow-рани конкурентно; жодного явного job-графа/`dependsOn` не потрібно.
- **Діапазон файлів усередині прогону**: `bunx n-rules lint <domain> --no-fix` — **без** `--full`, тобто дефолтний delta-режим (лише файли, змінені відносно `origin`). File-diff-реактивність тут вже є "з коробки".
- **Немає** module/service-каталогового поняття і **немає** зв'язку з deploy (ci-github канон deploy-пайплайнами не керує — це поза відповідальністю плагіна).

## Поточний стан — Azure (два незалежні шари, не плутати)

### Шар 1 — канон плагіна `@7n/rules-ci-azure`

Один файл `azure-pipelines.yml`, один pipeline (`backend-lint`, id 129 в efes), тригер — **кожен** push у `dev`/`main` без path-фільтра:

```yaml
steps:
  - script: bunx n-rules lint --no-fix --full
```

- Жодного domain-спліту (усі mixin-концерни `lint_pipeline_*` в одному кроці), жодного module-спліту, `--full` = увесь репозиторій щоразу.
- Це прямий аналог "усіх 10 GA lint-*.yml одночасно в одному job", але без їхнього нативного паралелізму — один послідовний прогін.

### Шар 2 — бespoke інженерія efes/backend (НЕ частина плагіна, зроблено цієї сесії в `.azurepipelines/templates/`)

18 деплой-пайплайнів (`run-nexus.yml`, `run-auth.yml`, `job-calc-route.yml`, ...), кожен тригериться по `paths.include` свого **модуль-каталогу** (де лежить `Dockerfile`). У кожен додано job `lint`:

```yaml
- job: lint
  steps:
    - script: bunx n-rules lint --path ${{ parameters.modulePath }} --no-fix
```

- **Тригер-гранулярність**: за модуль-каталогом (не за типом файлу) — увесь набір доменів лінтиться разом, коли ЗМІНЕНО щось у цьому конкретному модулі.
- **Паралелізм**: явний job-граф у межах однієї stage — `lint` і `run_tests` без `dependsOn` (паралельно), `build_and_push` з `dependsOn: [run_tests, lint]` (гейт публікації).
- **Діапазон файлів усередині прогону**: `--path <dir>` збирає **всі** файли під каталогом (`collectPathScopedFiles` — рекурсивний `walkDir`), **не** перетин із git-diff. Тобто на відміну від GA, тут немає file-level diff-реактивності всередині модуля — лінтиться весь модуль щоразу, коли модуль торкнутий.
- **Є** зв'язок із deploy: лінт гейтить `build_and_push`/`deploy_to_aks` для того самого модуля.

## Зведена таблиця асиметрій

| Вісь | GitHub Actions (канон плагіна) | Azure Шар 1 (канон плагіна) | Azure Шар 2 (efes, bespoke) |
|---|---|---|---|
| Тригер-гранулярність | тип файлу (repo-wide glob) | будь-який push (без фільтра) | модуль-каталог (Dockerfile-дир) |
| Domain-спліт | так, 10 окремих workflow | ні, один `--full` крок | ні, всі домени разом у `--path` |
| Паралелізм доменів | нативний (окремі workflow) | немає | немає (домени всередині одного `--path`-кроку) |
| Паралелізм модулів | н/д (немає поняття модуля) | н/д | так, 18 незалежних пайплайнів |
| File-diff усередині прогону | так (delta за замовчуванням) | ні (`--full`) | ні (`--path` = весь підкаталог) |
| Гейтить publish | ні (поза відповідальністю) | ні (немає deploy у цьому пайплайні) | так (`build_and_push` dependsOn) |

## More Information

Зачеплені файли для довідки в наступній сесії:

- Канон GA: `plugins/ci-github/rules/*/*/template/lint-*.yml.snippet.yml` (10 файлів), Rego-перевірки поряд.
- Канон Azure (плагін): `plugins/ci-azure/rules/azure-pipelines/{pipeline_common,lint_pipeline}/`.
- CLI-прапорець `--path`: `npm/bin/n-rules.js` (парсинг), `npm/scripts/lib/lint-surface/path-scope.mjs` (`collectPathScopedFiles` — не diff-aware, walkDir усього піддерева).
- Bespoke efes-шар: `.azurepipelines/templates/{deploy-service,deploy-cronjob,deploy-scaledjob}.yml` + `jobs/{run-tests,lint,build-push,deploy-*}.yml` (репозиторій `efes/backend`, гілка `dev`).
- Діаграми поточного стану Azure (тригер-топологія + job-граф): опубліковано як artifact цієї сесії (посилання — у транскрипті чату, не збережено окремим файлом).

Відкриті питання для сесії уніфікації (не вичерпний список, стартові тези):

1. Чи варто зробити `--path` diff-aware (перетин з git-diff, не весь підкаталог) — це б наблизило Azure Шар 2 до GA-поведінки й, ймовірно, пришвидшило б module-scoped лінт на великих модулях.
2. Чи виносити module-scoped-гейт patterns (job `lint` без `dependsOn`, `build_and_push` dependsOn на обидва) у сам канон `@7n/rules-ci-azure` як опційний темплейт для консюмерів із подібною deploy-структурою, чи лишати повністю консюмер-специфічним.
3. Чи потрібен symmetric GA-side gate (лінт гейтить GitHub-based деплой) — залежить від того, чи існують реальні консюмери з GA-деплоями, що потребують такого ж патерну.
4. Чи варто GA-канону теж отримати опційний module/service-спліт (10 workflow × N модулів) для монорепо-консюмерів такого ж масштабу, як efes, чи domain-спліт репо-wide залишається достатнім для GitHub-стеку.
