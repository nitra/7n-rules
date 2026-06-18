---
type: ADR
title: "Stryker: запуск через локально встановлений core-bin замість npx"
---

# Stryker: запуск через локально встановлений core-bin замість npx

**Status:** Accepted
**Date:** 2026-06-02

## Context and Problem Statement

`runStryker` у `npm/rules/js-lint/coverage/coverage.mjs` запускав `@stryker-mutator/core` через `npx`, що тягло core у власний npx-кеш без сусіднього `@stryker-mutator/vitest-runner`. Результат: `StrykerError: Cannot find TestRunner plugin "vitest"` при кожному `flow verify` coverage-gate.

## Considered Options

- `createRequire().resolve('@stryker-mutator/core/bin/stryker.js')` → запуск через `process.execPath`
- Резолвити через `package.json` → поле `bin`, запускати bin напряму (node-shebang)
- Залишити `npx @stryker-mutator/core`

## Decision Outcome

Chosen option: "Резолвити через `package.json#bin`, запускати bin напряму", because `exports` пакета не відкриває subpath `./bin/stryker.js` — `createRequire().resolve` із subpath кидає `ERR_PACKAGE_PATH_NOT_EXPORTED`. Резолв через `package.json` (`createRequire` → `.resolve('@stryker-mutator/core/package.json')` → `dirname` + поле `bin.stryker`) знаходить локальний bin поряд із `vitest-runner`; node-shebang гарантує виконання node незалежно від bun/node батьківського процесу.

### Consequences

- Good, because `flow verify` coverage-gate пройшов e2e (перший зелений за сесію): vitest runner завантажився, 34 тести, exit 0.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Файл: `npm/rules/js-lint/coverage/coverage.mjs`, нова функція `resolveLocalStrykerBin`. Гілка `flow-coverage-stryker-local` (`373ce42`) → `main`. Залежність: `@stryker-mutator/core` і `@stryker-mutator/vitest-runner` мають бути сусідами у `node_modules/@stryker-mutator/`.
