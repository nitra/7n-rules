---
session: 166067f9-58c4-48c2-afaa-547b28eb33db
captured: 2026-06-06T21:08:56+03:00
transcript: /Users/vitaliytv/.claude/projects/-Users-vitaliytv-www-nitra-cursor/166067f9-58c4-48c2-afaa-547b28eb33db.jsonl
---

## ADR Умовний pointer замість дублювання module-level JSDoc

## Context and Problem Statement
`.mjs`-скрипти в `npm/rules/*/js/` та `npm/skills/*/js/` мають розлогі module-level JSDoc-заголовки, які дублюють поведінковий контракт, вже зафіксований у `docs/<stem>.md` поряд із файлом. Це порушує принцип одного джерела істини, який вже закріплений у `scripts.mdc` для template-літералів.

## Considered Options
* **Завжди** замінювати module-level JSDoc на однорядковий pointer до `docs/<stem>.md` незалежно від наявності документації
* **Умовний pointer**: pointer лише якщо `docs/<stem>.md` існує; якщо docs немає — JSDoc-проза залишається (єдине джерело до появи документації)

## Decision Outcome
Chosen option: "Умовний pointer", because якщо docs для файлу ще немає, JSDoc-проза є єдиним джерелом контракту і видаляти її без capture означає втрату інформації; pointer доречний лише тоді, коли документ-відповідник вже існує і покриває поведінку.

### Consequences
* Good, because контракт ніколи не зникає: або він у `docs/<stem>.md`, або у JSDoc — третього не дано.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Реалізація: `npm/rules/npm-module/js/header_doc_pointer.mjs` — новий концерн `npm-module`; сканує всі `.mjs` у `npm/rules/*/js/` та `npm/skills/*/js/`; якщо поряд є `docs/<stem>.md`, перевіряє, що module-level JSDoc ≤ 1 змістовний рядок. Тести: `npm/rules/npm-module/js/tests/header_doc_pointer.test.mjs` (8/8 green). Документація концерну: `npm/rules/npm-module/js/docs/header_doc_pointer.md`. Правило задокументовано в новій секції `## Контракт: module-level JSDoc vs docs/` у `.cursor/rules/scripts.mdc`. Реальні порушення, виявлені першим запуском `check`: `npm/rules/abie/js/applies.mjs`, `env_dns.mjs`, `firebase_hosting.mjs` та ін. — вони підтвердили коректність логіки.

---

## ADR Enforcement через check-концерн, а не через прозу в `.mdc`

## Context and Problem Statement
Потрібно «закріпити контракт» між JSDoc і docs-файлами так, щоб він не зникав із часом і не потребував ручних ревʼю — відповідно до вже наявного принципу `mdc-check` у проєкті («максимум перевірюваної логіки у `check-{id}.mjs`, а не в прозі правила»).

## Considered Options
* Описати правило текстом у `.mdc` і покластися на ревʼюера чи LLM
* Реалізувати детермінований `check`-концерн, який механічно провалює CI при порушенні

## Decision Outcome
Chosen option: "Детермінований `check`-концерн", because він є «механічним замком»: після того, як прозу прибрано зі скрипта, повернутися назад неможливо без явного CI failure — точно як `_test.rego`-дрифт-тести в інших концернах.

### Consequences
* Good, because transcript фіксує очікувану користь: check запущений на реальному репо і одразу виявив конкретні файли-порушники, підтвердивши механічну надійність.
* Bad, because transcript не містить підтверджених негативних наслідків.

## More Information
Функція `check(root)` у `header_doc_pointer.mjs` повертає `0` (pass) або `1` (fail). Перевірка — текстова (regex до першого `import`/`export`), не Oxc AST, оскільки аналізується виключно текстова структура до першого оператора, а не семантика JavaScript. Тест-файл: `npm/rules/npm-module/js/tests/header_doc_pointer.test.mjs`, використовує `withTmpDir`/`ensureDir` з `npm/scripts/utils/test-helpers.mjs`.
