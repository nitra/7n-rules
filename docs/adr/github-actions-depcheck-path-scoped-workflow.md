---
type: ADR
title: "Обов'язкова перевірка depcheck у path-scoped GitHub Actions workflow"
---

# Обов'язкова перевірка depcheck у path-scoped GitHub Actions workflow

**Status:** Accepted
**Date:** 2026-05-06

## Контекст

Backend-пакети в монорепо мають власні GitHub Actions workflow з `paths:`-фільтром (наприклад, `cron-jobs/refund-loyalty-points/**`). Без явного кроку `depcheck` невикористані або відсутні залежності пакета залишаються непоміченими на CI.

## Рішення/Процедура/Факт

- `npm/mdc/js-run.mdc` (v1.2 → v1.3): додано секцію **«depcheck у GitHub Actions з path-фільтром»** — якщо `on.push.paths` / `on.pull_request.paths` містять лише шляхи одного workspace-пакета, у job обов'язковий крок `npx depcheck --ignores="graphql,bun"` з `working-directory: <rootDir>`.
- Нова утиліта `npm/scripts/utils/depcheck-workflow.mjs` — визначає, чи всі `paths:`-записи workflow ведуть у один каталог пакета, і перевіряє наявність відповідного `depcheck`-кроку з правильним `working-directory` та достатніми `--ignores`.
- `npm/scripts/check-js-run.mjs`: інтегровано виклик `checkDepcheckInWorkflows`; workflow зчитуються один раз через `gha-workflow.mjs`.
- `npm/tests/check-js-run-fixture.test.mjs`: 9 нових тест-кейсів (відсутні workflow, глобальні paths, path-scoped без depcheck, неправильний `working-directory`, відсутні `--ignores` тощо).
- `.github/workflows/npm-publish.yml` доповнено кроком `npx depcheck --ignores="graphql,bun,bun:test,@nitra/cursor"`.
- Версія: 1.8.184.

## Обґрунтування

Автоматична перевірка гарантує, що будь-який backend-пакет із path-scoped CI не пропустить проблеми із залежностями. `graphql` та `bun` є обов'язковими в ignores — вони використовуються в середовищі виконання Bun/GraphQL, але не відображаються як прямий `import` у коді.

## Розглянуті альтернативи

Не обговорювалися.

## Зачіпає

`npm/mdc/js-run.mdc`, `.cursor/rules/n-js-run.mdc`, `npm/scripts/utils/depcheck-workflow.mjs` (новий), `npm/scripts/check-js-run.mjs`, `npm/tests/check-js-run-fixture.test.mjs`, `.github/workflows/npm-publish.yml`, `npm/package.json`, `npm/CHANGELOG.md`.
