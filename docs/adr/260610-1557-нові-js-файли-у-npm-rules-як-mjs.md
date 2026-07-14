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

Уточнено реалізацію конвенції нових JS-файлів:

- Обрано варіант статичної інструкції в `js-lint.mdc`, без git-aware programmatic-перевірки нових `.js`-файлів, бо stateless-скан не відрізняє нові файли від існуючих.
- `js-lint.mdc` обрано єдиним домом конвенції, бо він крос-файловий і покриває backend та frontend; `js-run.mdc` backend-only.
- Приклади нового вихідного коду в правилах оновлено на `.mjs`, але конфіги тулінгу не перейменовувалися масово, щоб не ламати узгодженість doc↔check.
- Для `vitest.config.*` каноном став `vitest.config.mjs`; чекери зберігають backward-compat із `vitest.config.js`.
- Для `style-lint` чекер розширено на `stylelint.config.mjs` і `stylelint.config.cjs`.

Перевірки з transcript: для повʼязаних змін проходили тести шаблонів/посилань, Stryker/Vitest-конфігів і style-lint; фінальні числа зафіксовані в transcript як `190 passed | 2 skipped` для test-набору та `39 passed` для style-lint-набору.
