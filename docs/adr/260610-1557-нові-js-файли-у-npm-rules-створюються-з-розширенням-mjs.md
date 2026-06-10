---
session: 069b3ac7-bc49-4c0a-b402-41a02c2900c5
captured: 2026-06-10T15:57:14+03:00
transcript: /Users/vitalii/.claude/projects/-Users-vitalii-www-nitra-cursor/069b3ac7-bc49-4c0a-b402-41a02c2900c5.jsonl
---

## ADR Нові JS-файли у npm/rules створюються з розширенням `.mjs`

## Context and Problem Statement
У пакеті `npm/rules` правила та скрипти містять файли з розширенням `.js` і `.mjs`. Виникло питання про уніфікацію: яке розширення використовувати для **нових** файлів, щоб явно позначати ES Module семантику без зміни наявного коду.

## Considered Options
* Нові файли — `.mjs`; наявні `.js` залишаються як є
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "Нові файли — `.mjs`; наявні `.js` залишаються як є", because користувач явно сформулював це правило: нові файли повинні мати розширення `.mjs`, а міграція існуючих `.js` не потрібна.

### Consequences
* Good, because нові файли отримують явну ES Module семантику через розширення `.mjs`, що відповідає поточним glob-патернам правил (`*.{js,mjs,cjs,ts,tsx}` у `js-run.mdc`).
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Globs у `js-run/js-run.mdc` вже охоплюють обидва розширення: `**/src/**/*.{js,mjs,cjs,ts,tsx}` — зміна не потребує оновлення glob-патернів.
- Директорії правил із `.js` файлами всередині `js/`: `js-run/js/`, `js-lint/js/`, `npm-module/js/` — наявні `.js` у них залишаються без змін.
- Нові скрипти типу `fix.mjs` вже існують у директоріях правил (`js-run/fix.mjs`, `js-lint/fix.mjs`, `npm-module/fix.mjs`) — це підтверджує що патерн `.mjs` для нових файлів вже частково застосовується.
