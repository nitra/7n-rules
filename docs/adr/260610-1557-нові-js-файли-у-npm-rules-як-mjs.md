---
type: ADR
title: Нові JS-файли у npm/rules створюються з розширенням .mjs
description: Для нових файлів правил у npm/rules використовується .mjs, а наявні .js залишаються без міграції.
---

**Status:** Accepted
**Date:** 2026-06-10

## Context and Problem Statement

У пакеті `npm/rules` правила та скрипти містять файли з розширеннями `.js` і `.mjs`. Потрібно уніфікувати підхід для нових файлів так, щоб явно позначати ES Module семантику без масової міграції наявного коду.

## Considered Options

- Нові файли створювати з розширенням `.mjs`, а наявні `.js` залишити як є.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "Нові файли — `.mjs`; наявні `.js` залишаються як є", because користувач явно сформулював це правило: нові файли повинні мати розширення `.mjs`, а міграція існуючих `.js` не потрібна.

### Consequences

- Good, because нові файли отримують явну ES Module семантику через розширення `.mjs`.
- Neutral, because наявні `.js` файли в `npm/rules` залишаються без змін і transcript не містить вимоги до їх міграції.
- Bad, because transcript не містить підтверджених негативних наслідків.

## More Information

- Globs у `js-run/js-run.mdc` вже охоплюють обидва розширення: `**/src/**/*.{js,mjs,cjs,ts,tsx}`.
- Директорії правил із `.js` файлами всередині `js/`: `js-run/js/`, `js-lint/js/`, `npm-module/js/`; ці файли залишаються без змін.
- Нові скрипти типу `fix.mjs` вже існують у директоріях правил (`js-run/fix.mjs`, `js-lint/fix.mjs`, `npm-module/fix.mjs`), що підтверджує часткове застосування патерну `.mjs` для нових файлів.

## Update 2026-06-11

- Дім конвенції розширень обрано як `npm/rules/js-lint/js-lint.mdc`, а не `js-run.mdc`, because `js-run` явно backend-only, тоді як конвенція охоплює backend і frontend; `js-lint` має globs `**/*.{js,mjs,cjs,jsx,ts,tsx}`.
- Приклади нового вихідного коду оновлюються вибірково: `src/conn/`, `src/utils/`, `main.*`, store-файли переводяться на `.mjs`, але конфіги тулінгу не перейменовуються без узгодження з чекерами.
- Інтеграційні фікстури `js-run/js/tests/runtime/tests/check-fixture.test.mjs` переведені з `pg-write.js`, `mssql-write.js`, `lib/connections/pg-write.js` на відповідні `.mjs`, while юніт-матриця розширень лишається як backward-compat покриття.
- Перевірка після оновлення фікстур: 46 тестів пройшли.

## Update 2026-06-11

- Конвенція `.mjs`/`.cjs` для нових JS-файлів лишається статичною інструкцією в `.mdc`, without автоматичної git-aware перевірки, because stateless-скан не відрізняє нові файли від існуючих.
- `vitest.config.mjs` став каноном для чекерів і baseline: `npm/rules/test/js/vitest-config-pool-forks.mjs` приймає `.mjs` і `.js`, `npm/rules/test/js/stryker_config.mjs` резолвить `vitest.config.mjs` із fallback на `vitest.config.js`, baseline-файли Stryker оновлені на `configFile: 'vitest.config.mjs'`.
- `style-lint` закрив gap для `stylelint.config.mjs` і `stylelint.config.cjs`: `npm/rules/style-lint/js/tooling.mjs` розпізнає ці імена, додано тест-кейс для `stylelint.config.mjs`.
- Зафіксовані перевірки: для test-правила 190 passed | 2 skipped; для style-lint 39 passed.
