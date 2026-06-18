---
type: ADR
title: "Stryker: розширення mutate-scope та npx замість bunx"
---

# Stryker: розширення mutate-scope та npx замість bunx

**Status:** Accepted
**Date:** 2026-05-29

## Context and Problem Statement

Два пов'язаних питання Stryker у `npm/`:

1. `npm/stryker.config.mjs` мав тимчасове обмеження `mutate: ['rules/test/coverage/coverage.mjs']`. Увесь інший production-код залишався поза мутаційним покриттям.

2. `runStryker` у `coverage.mjs:236` викликав `bunx @stryker-mutator/core run`. `bunx` встановлює пакет у ізольований temp-каталог без `@stryker-mutator/vitest-runner` — Stryker падав з `StrykerError: Could not load plugin`.

## Considered Options

mutate-scope:
- Broad glob `rules/**/*.mjs` + `scripts/**/*.mjs` + `bin/**/*.{js,mjs}` з виключеннями `tests/`, `data/`, `template(s)/`, `fixtures/`
- Залишити обмеження до окремого завдання
- Інші варіанти в transcript не обговорювалися.

Runner:
- `npx @stryker-mutator/core run`
- `bunx @stryker-mutator/core run`

## Decision Outcome

Chosen option: "Broad glob із виключеннями + npx", because тимчасовий коментар явно позначав обмеження як тимчасове; `npx` шукає бінарник у `node_modules/.bin/` де `@stryker-mutator/vitest-runner` уже встановлено, тоді як `bunx` ізолює temp-env без peer-залежностей.

### Consequences

* Good, because mutation score відображає реальний стан покриття всього production-коду.
* Good, because `bun run coverage` exit code 0; помилка `vitest-runner not found` усунена.
* Neutral, because кількість мутантів суттєво зросла — час прогону збільшився.
* Bad, because transcript не містить підтверджених інших негативних наслідків.

## More Information

`npm/stryker.config.mjs` — `mutate`: `['scripts/**/*.mjs', 'rules/**/*.mjs', 'bin/**/*.{js,mjs}', '!**/tests/**', '!**/__fixtures__/**', '!**/fixtures/**', '!**/data/**', '!**/template/**', '!**/templates/**', 'rules/test/js/data/stryker_config/stryker-vue-macros-ignorer.mjs']`.

`stryker-vue-macros-ignorer.mjs` включено явним include попри виключення `data/` — єдиний `data/`-файл з власними юніт-тестами.

`coverage.mjs:236`: `spawnSync('bunx', …)` → `spawnSync('npx', …)`. Підтвердження: `ls …/bunx-501-@stryker-mutator/core@latest/node_modules/@stryker-mutator/` — `vitest-runner` відсутній.

`@nitra/cursor` `1.29.1 → 1.29.2`.

## Update 2026-05-29

### Уточнення: виявлення проблеми bunx

Виявлено під час першого `bun run coverage` після знімання `mutate`-обмеження: повідомлення `Resolved, downloaded and extracted [320]` у логу свідчило про свіжу ізольовану установку bunx. `npx` знаходить `node_modules/.bin/stryker` де `@stryker-mutator/vitest-runner@9.6.1` вже присутній.

## Update 2026-05-29

### test.skipIf(STRYKER_MUTATOR_WORKER) для integration-тесту

Після розширення `mutate`-glob Stryker мутував файли, що імпортуються `npm/tests/integration-repo-checks.test.mjs`. Workers виконують тест у sandboxed-середовищі, де `REPO_ROOT` вказує на tmp-sandbox — тест падав або давав false negatives.

Рішення: `test.skipIf(process.env.STRYKER_MUTATOR_WORKER)(…)`. `STRYKER_MUTATOR_WORKER` встановлюється Stryker у `child-process-proxy.js:32`. Скіпнутий тест класифікується як survived — коректний сигнал для коду без unit-coverage.

### Деталь detection hasVueFiles

`hasVueFiles(jsRoot)` у `stryker_config.mjs` — `node:fs/promises#glob('src/**/*.vue')` з exclude `node_modules`/`dist`/`reports`. Idempotency: `ensureBaselineFile` (`stryker_config.mjs:42-49`) не перезаписує при повторному запуску.

## Update 2026-05-29

### `test.skipIf(env.STRYKER_MUTATOR_WORKER)` для інтеграційних тестів

При розширенні `mutate` на весь production-код Stryker виконує інтеграційні тести у sandbox-workers, де відсутній реальний `.git`, shlex-paths відрізняються — що дає хибні failures і значно уповільнює прогон.

**Рішення:** `test.skipIf(env.STRYKER_MUTATOR_WORKER)` у `npm/tests/integration-repo-checks.test.mjs`. Stryker встановлює `STRYKER_MUTATOR_WORKER` у child-process env (`node_modules/@stryker-mutator/core/dist/src/child-proxy/child-process-proxy.js:32`) — умова чітко розрізняє звичайний запуск від мутаційного sandbox. Integration-тест пропускається в Stryker workers; mutation score рахується лише по unit-покритих функціях.
