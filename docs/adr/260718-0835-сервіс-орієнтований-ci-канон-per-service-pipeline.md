---
type: ADR
title: "Сервіс-орієнтований CI-канон: per-service pipeline, спільний для GitHub Actions і Azure Pipelines"
---

# Сервіс-орієнтований CI-канон: per-service pipeline, спільний для GitHub Actions і Azure Pipelines

**Status:** Accepted
**Date:** 2026-07-18

## Context and Problem Statement

Резюме-ADR [260718-0712](./260718-0712-резюме-job-матриць-ci-azure-vs-github-перед-уніфікацією.md) зафіксував три структурно різні CI-моделі: GA file-type workflows (delta, без модулів і deploy-гейта), Azure-канон плагіна (один `--full`-моноліт) і bespoke efes-шар (18 модульних пайплайнів, `--path` = весь підкаталог). Потрібен один канон деплой-гейта для обох CI.

## Decision Outcome

Канон — **per-service pipeline** однакової форми для GA (`.github/workflows/deploy-<service>.yml`) і Azure (`.azurepipelines/**/*.yml` із `trigger.paths.include`):

```
trigger: paths = каталог сервісу (напр. run/nexus)
  plan  (prep + `bunx n-rules ci plan --path <svc> --github|--azure`)
    ├─ lint-<domain> × N  (гейт по outputs плану; `bunx n-rules lint <domain> --path <svc> --no-fix`)
    ├─ test               (гейт по `any`)
    └─ deploy             (needs/dependsOn-ланцюг транзитивно досягає ВСІ перевірки;
                           Skipped-толерантний, Failed-нетолерантний)
```

Ухвалені рішення:

1. **Skip-логіка в CLI, не в CI-синтаксисі.** Нова команда `n-rules ci plan [--path <dir>] [--base <ref>] --github|--azure|--json` рахує перетин git-дельти з каталогом сервісу і по glob-ах **per-file** concerns віддає outputs (`js=true|false`, …, `any`, `has_tests`, `domains`) у `$GITHUB_OUTPUT` або `##vso[task.setvariable …;isOutput=true]`. Одна логіка для обох CI; «plan сказав true» ⇔ «lint щось запустить» (спільний планер `planConcernForDelta`/`computeActiveDomains`).
2. **`--path` став diff-aware** (відповідь на питання 1 резюме-ADR): дефолт — перетин піддерева з дельтою (merge-base `main`→`origin/main` або явний `--base`), лише per-file concerns; `--path --full` — історична поведінка (все піддерево). Це breaking для efes → мажорний бамп `@7n/rules`, міграція — додати `--full`.
3. **`lint <domain> --path <dir>` дозволено** (заборону знято): концерни домену × перетин.
4. **Full-scope концерни виключені з path-режиму повністю** (з glob і без): деплой сервісу не блокується whole-repo порушеннями поза сервісом. Їхнє місце — новий `lint --repo-wide` (лише `scope: full`, весь репозиторій) в окремому workflow/pipeline (`lint-repo.yml` у GA — обовʼязковий концерн `ga/lint_repo_yml`; в Azure цю роль виконує кореневий `azure-pipelines.yml` із `--full`), який **не гейтить деплой**.
5. **Module-scoped гейт увійшов у канони обох плагінів** (відповіді на питання 2–4 резюме-ADR: так, так, так) як **опційна форма**: rego-концерни `ga/service_deploy_workflow` і `azure-pipelines/service_deploy_pipeline` перевіряють структуру кожного знайденого per-service файлу (walkGlob; нуль збігів — мовчання). Перелік сервісів **консюмер-специфічний**, без реєстру в `.n-rules.json`.
6. **Fail-open, не мовчазний скіп**: нерезолвлена база дельти → `ci plan` ставить усі домени true, `lint --path` лінтить усе піддерево (з warning); недосяжна база → помилка. Канон-сніпети вимагають `fetch-depth: 0`/`fetchDepth: 0`.
7. **Співіснування, не заміна**: GA file-type workflows (`lint-js.yml`, …) лишаються — покривають зміни поза сервіс-каталогами; консюмер без сервісів валідний автоматично.
8. **Мультистек prep**: bun (`setup-bun-deps`/`bun install --frozen-lockfile`) — обовʼязковий prep кожної джоби з `bunx n-rules`; python-стек додає uv (`setup-uv` + `uv sync --locked`) — описано в .mdc, не в rego.

## Considered Options

- Замінити file-type workflows сервісними — відхилено (втрачається покриття спільних лібів/кореневих конфігів).
- Реєстр сервісів у `.n-rules.json` — відхилено (дублювання правди, форму можна перевірити walkGlob+rego без реєстру).
- Skip через CI-нативні механізми (dorny/paths-filter, YAML-conditions) — відхилено (дубльована логіка у двох синтаксисах, дрейф від фактичних glob-ів concerns).
- Diff-перетин усередині lint-кроку vs весь модуль — обрано перетин (рішення користувача; конформність усього модуля забезпечують `--repo-wide` і `lint --path --full` на вимогу).

## More Information

- CLI: `npm/scripts/lib/lint-surface/ci-plan.mjs` (нова), `path-scope.mjs` (`collectPathScopedChangedFiles`), `run-detectors.mjs` (`buildScopedDeltaPlan`, `computeActiveDomains`, `pathMode`/`repoWide`), `changed-files.mjs` (`resolveChangedBase(cwd, baseRef)`), `bin/n-rules.js` (`ci`-роутінг поза `ensureNRulesInRootDevDependencies` і локом).
- Плагіни: `plugins/ci-github/rules/ga/{service_deploy_workflow,lint_repo_yml}/`, `plugins/ci-azure/rules/azure-pipelines/service_deploy_pipeline/`.
- Компроміс: template-розкладка Azure (`- template:` efes-стилю) перевіряється лише поверхнево (параметр = каталог із `paths.include`) — rego не бачить розгорнутий YAML; повна форма шаблону — .mdc-канон.
- Наступні кроки поза цим репо: міграція efes/backend (18 пайплайнів → plan-джоба + domain-спліт + Skipped-толерантні conditions), e2e-звірка Skipped-семантики на живому pipeline.
