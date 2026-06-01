---
session: 56d4469f-942b-45f9-a176-cf4acad17841
captured: 2026-06-01T19:14:36+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/56d4469f-942b-45f9-a176-cf4acad17841.jsonl
---

## ADR Явна `devDependency` для `@e18e/eslint-plugin` у корені монорепо

## Context and Problem Statement

`@nitra/eslint-config@3.10.0` більше не містить `@e18e/eslint-plugin` у своїх `dependencies`, хоча CHANGELOG фіксує його додавання у 3.8.0. `.oxlintrc.json` монорепо оголошує `jsPlugins: ["@e18e/eslint-plugin"]` і правила `e18e/*`, покладаючись на транзитивне підтягування через `@nitra/eslint-config`. Після регресії плагін виживав лише як stale-hoist у `bun.lock`, що могло зламати fresh-install у CI.

## Considered Options

* Додати `@e18e/eslint-plugin` у root `devDependencies` явно
* Вимкнути `@e18e/*` з `.oxlintrc.json` (прибрати `jsPlugins` і правила `e18e/*`)

## Decision Outcome

Chosen option: "Додати `@e18e/eslint-plugin` у root `devDependencies` явно", because це швидкий обхід upstream-регресії, що зберігає активними всі `e18e/*`-правила лінтера без змін у `.oxlintrc.json`.

### Consequences

* Good, because `bun install` тепер гарантовано встановлює `@e18e/eslint-plugin@0.5.0` на чистому середовищі, зокрема у CI.
* Bad, because відхилення від попереднього канонічного правила (`@e18e/*` не оголошувати окремо) — залежність лишатиметься явною до моменту, коли upstream відновить транзитивний запис у `@nitra/eslint-config`.

## More Information

- `package.json` root: додано `"@e18e/eslint-plugin": "^0.5.0"` у `devDependencies`
- `npm/rules/js-lint-ci/js-lint-ci.mdc`: оновлено приклад `devDependencies` (додано `@e18e/eslint-plugin ^0.5.0`, версію `@nitra/eslint-config` підвищено до `^3.9.0`) і замінено примітку «Важливо» — тепер пояснює регресію `@nitra/eslint-config≥3.10.0` як причину явної залежності
- Підготовлено `n-llm-patch`-промпт для репозиторію `@nitra/eslint-config` з інструкцією відновити `@e18e/eslint-plugin` у `dependencies` і узгодити відсутній запис `[3.10.0]` у CHANGELOG
