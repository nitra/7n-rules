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

Після введення конвенції `.mjs`/`.cjs` її розмістили саме в `npm/rules/js-lint/js-lint.mdc`, бо `js-lint` охоплює backend і frontend через globs `**/*.{js,mjs,cjs,jsx,ts,tsx}`, тоді як `js-run` є backend-only.

Додатково зафіксовано межі автоматизації: stateless-перевірка не відрізняє нові `.js`-файли від існуючих, тому правило лишається статичною інструкцією в `.mdc`, без git-aware checker.

Приклади нового вихідного коду в правилах оновлено на `.mjs` вибірково: `npm/rules/js-run/js-run.mdc`, `npm/rules/js-bun-db/js-bun-db.mdc`, `npm/rules/vue/vue.mdc`. Конфіги тулінгу не переписували масово, щоб не ламати узгодженість doc↔check.

Окремо закрито технічні gaps:

- `vitest.config.mjs` став каноном у checker/baseline для Vitest; backward-compat із `vitest.config.js` збережено.
- `style-lint` навчився розпізнавати `stylelint.config.mjs` і `stylelint.config.cjs`.
- Інтеграційні фікстури `js-run/js/tests/runtime/tests/check-fixture.test.mjs` переведено з `pg-write.js` / `mssql-write.js` на `.mjs`, залишивши unit-матрицю розширень для backward-compat.
