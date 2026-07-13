---
type: ADR
title: "Нові JS-файли у npm/rules створюються з розширенням .mjs"
description: Нові JavaScript-файли в `npm/rules` мають використовувати `.mjs`, а наявні `.js` лишаються без масової міграції.
---

**Status:** Accepted

**Date:** 2026-06-10

## Context and Problem Statement

У пакеті `npm/rules` правила та скрипти містять файли з розширенням `.js` і `.mjs`. Потрібно уніфікувати розширення для нових файлів, щоб явно позначати ES Module семантику без зміни наявного коду.

## Considered Options

- Нові файли створювати з розширенням `.mjs`, а наявні `.js` залишити як є.
- Інші варіанти в transcript не обговорювалися.

## Decision Outcome

Chosen option: "нові файли — `.mjs`; наявні `.js` залишаються як є", because користувач явно сформулював це правило: нові файли повинні мати розширення `.mjs`, а міграція існуючих `.js` не потрібна.

### Consequences

- Good, because нові файли отримують явну ES Module семантику через розширення `.mjs`.
- Good, because наявні glob-патерни вже охоплюють `*.{js,mjs,cjs,ts,tsx}`, тому зміна не потребує оновлення glob-патернів.
- Bad, because transcript не містить підтверджених негативних наслідків.
- Neutral, because наявні `.js` файли в директоріях правил не перейменовуються.

## More Information

- Globs у `js-run/js-run.mdc` вже охоплюють обидва розширення: `**/src/**/*.{js,mjs,cjs,ts,tsx}`.
- Директорії правил із `.js` файлами всередині `js/`: `js-run/js/`, `js-lint/js/`, `npm-module/js/`.
- Нові скрипти типу `fix.mjs` уже існують у директоріях правил: `js-run/fix.mjs`, `js-lint/fix.mjs`, `npm-module/fix.mjs`.
