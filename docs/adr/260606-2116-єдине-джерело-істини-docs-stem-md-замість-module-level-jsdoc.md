---
session: 166067f9-58c4-48c2-afaa-547b28eb33db
captured: 2026-06-06T21:16:26+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/166067f9-58c4-48c2-afaa-547b28eb33db.jsonl
---

## ADR Єдине джерело істини: `docs/<stem>.md` замість module-level JSDoc

## Context and Problem Statement
У кодовій базі `npm/rules/*/js/` та `npm/skills/*/js/` module-level JSDoc-заголовки скриптів дублювали контент, який вже був у `docs/<stem>.md`, створеному `n-docgen`. Два джерела одного контракту дрейфували незалежно — проблема, аналогічна drift-у inline-літералів у `template/`-файлах, який вже забороняє `scripts.mdc`.

## Considered Options
* Якщо `docs/<stem>.md` існує → замінити module-level JSDoc на однорядковий pointer (`/** @see ./docs/<stem>.md */`); якщо docs відсутні → залишити header як єдине джерело.
* Інші варіанти в transcript не обговорювалися.

## Decision Outcome
Chosen option: "pointer-when-docs-exist", because docs-файли є більшими і повнішими (3–10× за обсягом) і вже містять весь семантичний контент headers; дублювання у скрипті — зайве і несе ризик дрейфу.

### Consequences
* Good, because механічний check (`header_doc_pointer.mjs`) тепер не дозволяє наративному header відрости назад після видалення: `npm-module` discovery підхоплює концерн автоматично.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
- Новий концерн: `npm/rules/npm-module/js/header_doc_pointer.mjs`
- Тести (8/8 зелені): `npm/rules/npm-module/js/tests/header_doc_pointer.test.mjs`
- Docs поруч: `npm/rules/npm-module/js/docs/header_doc_pointer.md`
- Нова секція «Контракт: module-level JSDoc vs docs/» додана до `.cursor/rules/scripts.mdc`
- Batch-заміна 59 файлів: inline Node.js скрипт (replace MODULE_JSDOC_RE на `/** @see ./docs/<stem>.md */`)
- Перевірка цілісності: `grep` по ключових концептах (`N_CURSOR_CHANGELOG_AUTOFIX`, `resources.requests.cpu`, `EXPLICIT_K8S_SCHEMAS` тощо) підтвердила присутність контенту у відповідних `docs/*.md`; `check(cwd())` повернув `exit: 0`
