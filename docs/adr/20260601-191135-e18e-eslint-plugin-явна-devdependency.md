# Явна devDependency для `@e18e/eslint-plugin` у корені монорепо

**Status:** Accepted
**Date:** 2026-06-01

## Context and Problem Statement

`@nitra/eslint-config@3.10.0` більше не постачає `@e18e/eslint-plugin` як транзитивну залежність, хоча `.oxlintrc.json` оголошує `"jsPlugins": ["@e18e/eslint-plugin"]`. `bun run lint` падав із помилкою відсутнього плагіна. Правило `npm/rules/js-lint-ci/js-lint-ci.mdc` стверджувало транзитивне підключення через `@nitra/eslint-config` з версії 3.8.0, проте `package.json` версії 3.10.0 не містить `@e18e/*` у залежностях.

## Considered Options

* Додати `@e18e/eslint-plugin` до root `devDependencies` явно
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Додати `@e18e/eslint-plugin` до root `devDependencies` явно", because транзитивне підключення через `@nitra/eslint-config` виявилось ненадійним після оновлення до 3.10.0 — `@e18e/*` відсутній у залежностях 3.10.0; покладатись на транзитивність для явно декларованого плагіна некоректно.

### Consequences

* Good, because `bun run lint` відновив роботу після встановлення `@e18e/eslint-plugin@0.5.0`.
* Bad, because transcript не містить підтверджених негативних наслідків.
* Neutral, because при наступному оновленні `@nitra/eslint-config` слід перевіряти, чи `@e18e/*` знову з'явився як транзитивна залежність — у такому разі явна залежність стає надлишковою.

## More Information

- `.oxlintrc.json`: `"jsPlugins": ["@e18e/eslint-plugin"]` — місце декларації плагіна.
- `npm/rules/js-lint-ci/js-lint-ci.mdc` — стверджувало транзитивне підключення з `@nitra/eslint-config@3.8.0` (виявилось неактуальним для 3.10.0).
- `@nitra/eslint-config@3.10.0` `package.json` не містить `@e18e/*` у залежностях — підтверджено ревізією.
- Команда: `bun add -d @e18e/eslint-plugin` → встановлено `@e18e/eslint-plugin@0.5.0`.
- Додаткової інформації в transcript не зафіксовано щодо того, чи є відсутність транзитивної залежності навмисним рішенням `@nitra/eslint-config`.
