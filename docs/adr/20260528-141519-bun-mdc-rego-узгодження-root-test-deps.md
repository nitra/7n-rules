---
type: ADR
title: "Узгодження виключення root-only тестових пакетів у `bun.mdc` та `package_json.rego`"
---

# Узгодження виключення root-only тестових пакетів у `bun.mdc` та `package_json.rego`

**Status:** Accepted
**Date:** 2026-05-28

## Context and Problem Statement

У правилі `bun` (`@nitra/cursor`) існував розсинхрон між текстовим описом у `bun.mdc` і rego-полісі `package_json.rego`: `bun.mdc` (v1.9) описував виняток для `vitest`, `@vitest/coverage-v8`, `@stryker-mutator/vitest-runner` у root `devDependencies` як dog food-виключення для самого `@nitra/cursor`, тоді як `package_json.rego` фактично дозволяв ці пакети у root `devDependencies` будь-якого проєкту-споживача (`allowed_root_test_deps` — глобальний whitelist без перевірки імені репо).

Розсинхрон проявлявся у консьюмер-репо `ai`: `bun run coverage` (→ `n-cursor coverage`) падав із підказкою додати `vitest`/`@vitest/coverage-v8`/`@stryker-mutator/vitest-runner` у root, тоді як текст `bun.mdc` цей крок забороняв як «лише для dog food».

## Considered Options

* Узгодити `bun.mdc` під фактичну поведінку `package_json.rego` — дозволити виняток у будь-якому монорепо-споживачі, спираючись на структурну причину (`npm-module.mdc` забороняє `devDependencies` у published workspace).
* Звузити `package_json.rego` під mdc-текст — додати перевірку імені репо, лишити як dog food виняток. Цей варіант зламав би `ai` та інших споживачів `n-cursor coverage`.

## Decision Outcome

Chosen option: «Узгодити `bun.mdc` під `package_json.rego` — дозволити `vitest`, `@vitest/coverage-v8`, `@stryker-mutator/vitest-runner` у root `devDependencies` як загальний виняток для всіх монорепо-споживачів», because rego вже фактично реалізував цей дозвіл, а звуження зламало б консьюмерів. Структурне обґрунтування: published workspace `npm/` не має `devDependencies` за `npm-module.mdc`, а оркестратор `n-cursor coverage` запускається з кореня — отже корінь монорепо є єдиним місцем, де ці peer-tools можуть жити.

Виняток виноситься не на ім'я репо, а на always-on правило `test` (див. парний ADR `20260528-142508-test-правило-always-on.md`): кожен споживач, у кого `test` enabled, очікувано має ці peer-tools у root.

### Consequences

* Good, because проєкти-споживачі (як репо `ai`) отримують узгоджені правила й `bun run coverage` більше не падає з хибною помилкою про відсутній `vitest`.
* Good, because `bun.mdc` і `package_json.rego` тепер мають одне джерело правди — `npm-module.mdc` + always-on `test`.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

Змінені файли:

- `npm/rules/bun/bun.mdc` — version `1.9 → 2.0`, прибрано «лише для dog food-репо», додано структурне пояснення.
- `.cursor/rules/n-bun.mdc` — дзеркало `bun.mdc`.
- `npm/rules/bun/policy/package_json/package_json.rego` — оновлено docstring і коментар на `allowed_root_dev_dependency`: посилання на always-on `test/auto.md` + `npm-module.mdc`. Логіка `allowed_root_test_deps` без змін.
- `npm/package.json` — `1.28.3 → 1.28.4`.
- `npm/CHANGELOG.md` — запис `[1.28.4]`.

Тести після змін: rego 14/14 (`conftest verify -p npm/rules/bun/policy/package_json`), vitest 313/313 (`bun x vitest run npm/scripts`), bun-rules 10/10.

Пов'язано: [`20260528-142508-test-правило-always-on.md`](20260528-142508-test-правило-always-on.md) — парне рішення про перехід `test` у always-on, без якого цей виняток не мав би загального обґрунтування.
